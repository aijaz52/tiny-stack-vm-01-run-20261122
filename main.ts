import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Opcode metadata: immediate bytes, values popped, values pushed.
const ops: number[][] = [];
for (const [op, imm, pop, push] of [
  [0x00,0,0,0], [0x01,1,0,1], [0x02,4,0,1], [0x03,0,1,0],
  [0x04,0,1,2], [0x05,0,2,2], [0x06,0,2,3], [0x07,0,3,3],
  [0x30,2,0,0], [0x31,2,1,0], [0x32,2,1,0], [0x33,2,0,0],
  [0x34,0,0,0], [0x40,0,1,1], [0x41,0,2,0],
  [0x50,0,1,0], [0x51,0,1,0], [0x52,0,0,1], [0x53,0,1,0]
]) ops[op] = [imm, pop, push];
for (let op = 0x10; op <= 0x22; op++)
  if (op !== 0x1f) ops[op] = [0, op === 0x17 || op === 0x1b ? 1 : 2, 1];

export function run(program: Uint8Array, input: Uint8Array) {
  // Int32Array stores wrap every arithmetic result modulo 2^32.
  const s = new Int32Array(256), calls = new Int32Array(64);
  const memory = new Int32Array(256), out = Buffer.alloc(65536);
  let pc = 0, steps = 0, pos = 0, length = 0, sp = 0, cp = 0;
  const done = (exit: number) => ({ stdout: out.subarray(0, length), exit });
  for (;;) {
    if (steps === 1000000) return done(10);
    if (pc < 0 || pc >= program.length) return done(9);
    const op = program[pc], spec = ops[op];
    if (!spec) return done(5);
    const [imm, pop, push] = spec;
    if (pc + imm >= program.length) return done(9);
    steps++;
    if (sp < pop) return done(2);
    if (sp - pop + push > s.length) return done(3);
    pc += 1 + imm;
    const b = s[sp - 1], a = s[sp - 2], c = s[sp - 3];
    sp -= pop;
    switch (op) {
      case 0x00: return done(0);
      case 0x01: s[sp++] = program[pc - 1] << 24 >> 24; break;
      case 0x02:
        s[sp++] = program[pc - 4] | program[pc - 3] << 8 |
          program[pc - 2] << 16 | program[pc - 1] << 24; break;
      case 0x03: break;
      case 0x04: s[sp++] = b; s[sp++] = b; break;
      case 0x05: s[sp++] = b; s[sp++] = a; break;
      case 0x06: s[sp++] = a; s[sp++] = b; s[sp++] = a; break;
      case 0x07: s[sp++] = a; s[sp++] = b; s[sp++] = c; break;
      case 0x17: s[sp++] = -b; break;
      case 0x1b: s[sp++] = ~b; break;
      case 0x30: case 0x31: case 0x32:
        if (op === 0x30 || (op === 0x31 ? b === 0 : b !== 0))
          pc += (program[pc - 2] | program[pc - 1] << 8) << 16 >> 16;
        break;
      case 0x33:
        if (cp === calls.length) return done(7);
        calls[cp++] = pc;
        pc = program[pc - 2] | program[pc - 1] << 8;
        break;
      case 0x34:
        if (!cp) return done(8);
        pc = calls[--cp]; break;
      case 0x40: case 0x41:
        if (b < 0 || b > 255) return done(6);
        if (op === 0x40) s[sp++] = memory[b];
        else memory[b] = a;
        break;
      case 0x50: case 0x51: {
        const text = op === 0x50 ? String(b) : String.fromCharCode(b & 255);
        if (length + text.length > out.length) return done(11);
        length += out.write(text, length, 'latin1'); break;
      }
      case 0x52: s[sp++] = pos < input.length ? input[pos++] : -1; break;
      case 0x53: return done(b & 255);
      default: {
        if (op >= 0x13 && op <= 0x16 && b === 0) return done(4);
        let r;
        switch (op) {
          case 0x10: r = a + b; break;
          case 0x11: r = a - b; break;
          case 0x12: r = Math.imul(a, b); break;
          case 0x13: r = a / b; break;
          case 0x14: r = a % b; break;
          case 0x15: r = (a >>> 0) / (b >>> 0); break;
          case 0x16: r = (a >>> 0) % (b >>> 0); break;
          case 0x18: r = a & b; break;
          case 0x19: r = a | b; break;
          case 0x1a: r = a ^ b; break;
          case 0x1c: r = a << b; break;
          case 0x1d: r = a >> b; break;
          case 0x1e: r = a >>> b; break;
          case 0x20: r = +(a === b); break;
          case 0x21: r = +(a < b); break;
          case 0x22: r = +((a >>> 0) < (b >>> 0)); break;
        }
        s[sp++] = r;
      }
    }
  }
}

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
for (const id of readdirSync(I).sort()) {
  const result = run(readFileSync(join(I, id, 'program.bin')), readFileSync(join(I, id, 'input.bin')));
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'stdout.bin'), result.stdout);
  writeFileSync(join(O, id, 'exit.txt'), result.exit + '\n');
}
