import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const STACK_LIMIT = 256, CALL_LIMIT = 64, MEMORY_LIMIT = 256;
const STEP_LIMIT = 1_000_000, OUTPUT_LIMIT = 65_536;
// One byte per opcode: valid bit, pushes (2 bits), pops (2), immediate (3).
// A zero table entry is invalid; 0x1f intentionally stays unassigned.
const ops = new Uint8Array(256);
const define = (op: number, imm: number, pop: number, push: number) =>
  ops[op] = 128 | (push << 5) | (pop << 3) | imm;
for (const [op, imm, pop, push] of [
  [0x00,0,0,0], [0x01,1,0,1], [0x02,4,0,1], [0x03,0,1,0],
  [0x04,0,1,2], [0x05,0,2,2], [0x06,0,2,3], [0x07,0,3,3],
  [0x30,2,0,0], [0x31,2,1,0], [0x32,2,1,0], [0x33,2,0,0],
  [0x34,0,0,0], [0x40,0,1,1], [0x41,0,2,0],
  [0x50,0,1,0], [0x51,0,1,0], [0x52,0,0,1], [0x53,0,1,0]
]) define(op, imm, pop, push);
for (let op = 0x10; op <= 0x22; op++)
  if (op !== 0x1f) define(op, 0, op === 0x17 || op === 0x1b ? 1 : 2, 1);

export function run(program: Uint8Array, input: Uint8Array) {
  const s = new Int32Array(STACK_LIMIT), calls = new Int32Array(CALL_LIMIT);
  const memory = new Int32Array(MEMORY_LIMIT), out = new Uint8Array(OUTPUT_LIMIT);
  let pc = 0, steps = 0, pos = 0, length = 0, sp = 0, cp = 0;
  const done = (exit: number) => ({ stdout: out.subarray(0, length), exit });
  for (;;) {
    // Trap precedence is steps, fetch, opcode, immediate, then stack effects.
    if (steps >= STEP_LIMIT) return done(10);
    if (pc < 0 || pc >= program.length) return done(9);
    const op = program[pc], spec = ops[op];
    if (!spec) return done(5);
    const imm = spec & 7, pop = (spec >> 3) & 3, push = (spec >> 5) & 3;
    const next = pc + 1 + imm;
    if (next > program.length) return done(9);
    steps++;
    if (sp < pop) return done(2);
    if (sp - pop + push > STACK_LIMIT) return done(3);
    pc = next;
    const b = s[sp - 1], a = s[sp - 2];
    if (op >= 0x13 && op <= 0x16 && b === 0) return done(4);
    if ((op === 0x40 || op === 0x41) && (b < 0 || b >= MEMORY_LIMIT)) return done(6);
    sp -= pop;
    let r = b;
    switch (op) {
      case 0x00: return done(0);
      case 0x01: r = program[next - 1] << 24 >> 24; break;
      case 0x02:
        r = program[next - 4] | (program[next - 3] << 8) |
          (program[next - 2] << 16) | (program[next - 1] << 24);
        break;
      case 0x03: continue;
      case 0x04: s[sp++] = b; break;
      case 0x05: s[sp++] = b; r = a; break;
      case 0x06: s[sp++] = a; s[sp++] = b; r = a; break;
      case 0x07: r = s[sp]; s[sp++] = a; s[sp++] = b; break;
      case 0x10: r = a + b; break;
      case 0x11: r = a - b; break;
      case 0x12: r = Math.imul(a, b); break;
      case 0x13: r = a === -2147483648 && b === -1 ? a : Math.trunc(a / b) | 0; break;
      case 0x14: r = b === -1 ? 0 : a % b | 0; break;
      case 0x15: r = Math.floor((a >>> 0) / (b >>> 0)) | 0; break;
      case 0x16: r = (a >>> 0) % (b >>> 0) | 0; break;
      case 0x17: r = -b; break;
      case 0x18: r = a & b; break;
      case 0x19: r = a | b; break;
      case 0x1a: r = a ^ b; break;
      case 0x1b: r = ~b; break;
      case 0x1c: r = a << (b & 31); break;
      case 0x1d: r = a >> (b & 31); break;
      case 0x1e: r = a >>> (b & 31); break;
      case 0x20: r = +(a === b); break;
      case 0x21: r = +(a < b); break;
      case 0x22: r = +((a >>> 0) < (b >>> 0)); break;
      case 0x30: case 0x31: case 0x32:
        if (op === 0x30 || (op === 0x31 ? b === 0 : b !== 0))
          pc = next + ((program[next - 2] | (program[next - 1] << 8)) << 16 >> 16);
        continue;
      case 0x33:
        if (cp === CALL_LIMIT) return done(7);
        calls[cp++] = pc;
        pc = program[next - 2] | (program[next - 1] << 8);
        continue;
      case 0x34:
        if (!cp) return done(8);
        pc = calls[--cp]; continue;
      case 0x40: case 0x41:
        if (op === 0x41) { memory[b] = a; continue; }
        r = memory[b];
        break;
      case 0x50: {
        const text = String(b);
        if (text.length > OUTPUT_LIMIT - length) return done(11);
        for (let i = 0; i < text.length; i++) out[length++] = text.charCodeAt(i);
        continue;
      }
      case 0x51:
        if (length === OUTPUT_LIMIT) return done(11);
        out[length++] = b & 255;
        continue;
      case 0x52: r = pos < input.length ? input[pos++] : -1; break;
      case 0x53: return done(b & 255);
    }
    // Every produced value is stored as a signed 32-bit integer.
    if (push) s[sp++] = r | 0;
  }
}

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
for (const id of readdirSync(I).sort()) {
  const source = join(I, id), target = join(O, id);
  const result = run(readFileSync(join(source, 'program.bin')), readFileSync(join(source, 'input.bin')));
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, 'stdout.bin'), result.stdout);
  writeFileSync(join(target, 'exit.txt'), result.exit + '\n');
}
