import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Packed metadata: valid bit, pushes, pops, immediate bytes.
const ops = new Uint8Array(256);
for (const [op, imm, pop, push] of [
  [0x00,0,0,0], [0x01,1,0,1], [0x02,4,0,1], [0x03,0,1,0],
  [0x04,0,1,2], [0x05,0,2,2], [0x06,0,2,3], [0x07,0,3,3],
  [0x30,2,0,0], [0x31,2,1,0], [0x32,2,1,0], [0x33,2,0,0],
  [0x34,0,0,0], [0x40,0,1,1], [0x41,0,2,0],
  [0x50,0,1,0], [0x51,0,1,0], [0x52,0,0,1], [0x53,0,1,0]
]) ops[op] = 128 | push << 5 | pop << 3 | imm;
for (let op = 0x10; op <= 0x22; op++)
  if (op !== 0x1f) ops[op] = 160 | (op === 0x17 || op === 0x1b ? 1 : 2) << 3;

export function run(program: Uint8Array, input: Uint8Array) {
  const code = new DataView(program.buffer, program.byteOffset, program.byteLength);
  const s = new Int32Array(256), calls = new Int32Array(64);
  const memory = new Int32Array(256), out = new Uint8Array(65536);
  let pc = 0, steps = 0, pos = 0, length = 0, sp = 0, cp = 0;
  const done = (exit: number) => ({ stdout: out.slice(0, length), exit });
  for (;;) {
    if (steps >= 1000000) return done(10);
    if (pc < 0 || pc >= program.length) return done(9);
    const op = program[pc], spec = ops[op];
    if (!(spec & 128)) return done(5);
    const imm = spec & 7, pop = spec >> 3 & 3, push = spec >> 5 & 3;
    if (pc + imm >= program.length) return done(9);
    steps++;
    if (sp < pop) return done(2);
    if (sp - pop + push > s.length) return done(3);
    pc += 1 + imm;
    const b = s[sp - 1], a = s[sp - 2], c = s[sp - 3];
    sp -= pop;
    if (op >= 0x13 && op <= 0x16 && b === 0) return done(4);
    let r = b;
    switch (op) {
      case 0x00: return done(0);
      case 0x01: r = code.getInt8(pc - 1); break;
      case 0x02: r = code.getInt32(pc - 4, true); break;
      case 0x03: continue;
      case 0x04: s[sp++] = b; break;
      case 0x05: s[sp++] = b; r = a; break;
      case 0x06: s[sp++] = a; s[sp++] = b; r = a; break;
      case 0x07: s[sp++] = a; s[sp++] = b; r = c; break;
      case 0x10: r = a + b; break;
      case 0x11: r = a - b; break;
      case 0x12: r = Math.imul(a, b); break;
      case 0x13: r = a / b; break;
      case 0x14: r = a % b; break;
      case 0x15: r = (a >>> 0) / (b >>> 0); break;
      case 0x16: r = (a >>> 0) % (b >>> 0); break;
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
          pc += code.getInt16(pc - 2, true);
        continue;
      case 0x33:
        if (cp === calls.length) return done(7);
        calls[cp++] = pc;
        pc = code.getUint16(pc - 2, true);
        continue;
      case 0x34:
        if (!cp) return done(8);
        pc = calls[--cp]; continue;
      case 0x40: case 0x41:
        if (b < 0 || b >= memory.length) return done(6);
        if (op === 0x41) { memory[b] = a; continue; }
        r = memory[b];
        break;
      case 0x50: case 0x51: {
        const bytes = op === 0x50 ? Buffer.from(String(b)) : Uint8Array.of(b & 255);
        if (length + bytes.length > out.length) return done(11);
        out.set(bytes, length);
        length += bytes.length;
        continue;
      }
      case 0x52: r = pos < input.length ? input[pos++] : -1; break;
      case 0x53: return done(b & 255);
    }
    // Int32Array stores truncate and wrap, including INT_MIN / -1 and -0.
    s[sp++] = r;
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
