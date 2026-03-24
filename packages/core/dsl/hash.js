import { exportGroupDsl } from "./export.js";

function leftRotate(value, bits) {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}

function computeSha1Hex(value) {
  const encoder = new TextEncoder();
  const input = encoder.encode(String(value));
  const bitLength = input.length * 8;
  const paddedLength = ((input.length + 9 + 63) >> 6) << 6;
  const data = new Uint8Array(paddedLength);
  const view = new DataView(data.buffer);
  const words = new Uint32Array(80);

  data.set(input);
  data[input.length] = 0x80;
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4, false);
    }

    for (let index = 16; index < 80; index += 1) {
      words[index] = leftRotate(
        words[index - 3] ^ words[index - 8] ^ words[index - 14] ^ words[index - 16],
        1,
      );
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;

    for (let index = 0; index < 80; index += 1) {
      let f = 0;
      let k = 0;

      if (index < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (index < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (index < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }

      const temp = (leftRotate(a, 5) + f + e + k + words[index]) >>> 0;
      e = d;
      d = c;
      c = leftRotate(b, 30);
      b = a;
      a = temp;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  return [h0, h1, h2, h3, h4].map((part) => part.toString(16).padStart(8, "0")).join("");
}

export function computeGroupDslSemanticHash(groupDefinition, registry, options = {}) {
  const exported = exportGroupDsl(groupDefinition, registry, {
    ...options,
    annotated: false,
  });

  if (!exported.ok) {
    return exported;
  }

  const payload = JSON.stringify({
    preserveInternalCableDelays:
      groupDefinition?.preserveInternalCableDelays === true,
    dsl: exported.text,
  });

  return {
    ok: true,
    hash: computeSha1Hex(payload),
    text: exported.text,
  };
}
