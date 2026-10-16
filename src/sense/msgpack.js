// -----------------------------------------------------------------------------
// A minimal MessagePack decoder (https://github.com/msgpack/msgpack/blob/master/spec.md),
// enough for the Sense real-time feed: recent versions of sense-energy ask
// for msgpack frames (three concatenated values: type, epoch, payload). This
// integration asks for JSON, but decodes a binary frame the same way rather
// than depend on a library. Extension types are skipped (decoded as null).
// -----------------------------------------------------------------------------

class Truncated extends Error {}

const textDecoder = new TextDecoder();

/** Decode every complete value of `input` (Uint8Array, ArrayBuffer or Buffer). */
export function decodeAll(input) {
  const bytes =
    input instanceof Uint8Array ? input : new Uint8Array(input instanceof ArrayBuffer ? input : []);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 0;

  const need = (n) => {
    if (pos + n > bytes.length) {
      throw new Truncated();
    }
  };
  const take = (n) => {
    need(n);
    const start = pos;
    pos += n;
    return start;
  };
  const u8 = () => bytes[take(1)];
  const u16 = () => view.getUint16(take(2));
  const u32 = () => view.getUint32(take(4));
  const str = (n) => {
    const start = take(n);
    return textDecoder.decode(bytes.subarray(start, start + n));
  };
  const bin = (n) => {
    const start = take(n);
    return bytes.slice(start, start + n);
  };
  const ext = (n) => {
    take(1 + n); // type byte + data
    return null;
  };
  const array = (n) => {
    const out = [];
    for (let i = 0; i < n; i += 1) {
      out.push(read());
    }
    return out;
  };
  const map = (n) => {
    const out = {};
    for (let i = 0; i < n; i += 1) {
      const key = String(read());
      const value = read();
      if (key !== '__proto__') {
        out[key] = value;
      }
    }
    return out;
  };

  function read() {
    const b = u8();
    if (b <= 0x7f) return b;
    if (b >= 0xe0) return b - 0x100;
    if (b >= 0x80 && b <= 0x8f) return map(b & 0x0f);
    if (b >= 0x90 && b <= 0x9f) return array(b & 0x0f);
    if (b >= 0xa0 && b <= 0xbf) return str(b & 0x1f);
    switch (b) {
      case 0xc0:
        return null;
      case 0xc2:
        return false;
      case 0xc3:
        return true;
      case 0xc4:
        return bin(u8());
      case 0xc5:
        return bin(u16());
      case 0xc6:
        return bin(u32());
      case 0xc7:
        return ext(u8());
      case 0xc8:
        return ext(u16());
      case 0xc9:
        return ext(u32());
      case 0xca:
        return view.getFloat32(take(4));
      case 0xcb:
        return view.getFloat64(take(8));
      case 0xcc:
        return u8();
      case 0xcd:
        return u16();
      case 0xce:
        return u32();
      case 0xcf:
        return Number(view.getBigUint64(take(8)));
      case 0xd0:
        return view.getInt8(take(1));
      case 0xd1:
        return view.getInt16(take(2));
      case 0xd2:
        return view.getInt32(take(4));
      case 0xd3:
        return Number(view.getBigInt64(take(8)));
      case 0xd4:
        return ext(1);
      case 0xd5:
        return ext(2);
      case 0xd6:
        return ext(4);
      case 0xd7:
        return ext(8);
      case 0xd8:
        return ext(16);
      case 0xd9:
        return str(u8());
      case 0xda:
        return str(u16());
      case 0xdb:
        return str(u32());
      case 0xdc:
        return array(u16());
      case 0xdd:
        return array(u32());
      case 0xde:
        return map(u16());
      case 0xdf:
        return map(u32());
      default:
        throw new Error(`Invalid MessagePack byte 0x${b.toString(16)}`);
    }
  }

  const values = [];
  while (pos < bytes.length) {
    try {
      values.push(read());
    } catch (err) {
      if (err instanceof Truncated) {
        break; // an incomplete value at the end: dropped
      }
      throw err;
    }
  }
  return values;
}
