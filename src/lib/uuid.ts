export function randomId(): string {
  const globalCrypto = (globalThis as unknown as { crypto?: Crypto }).crypto;

  const randomUUID = globalCrypto
    ? (globalCrypto as unknown as { randomUUID?: () => string }).randomUUID
    : undefined;
  if (typeof randomUUID === "function") {
    return randomUUID.call(globalCrypto);
  }

  const bytes = new Uint8Array(16);
  if (globalCrypto && typeof globalCrypto.getRandomValues === "function") {
    globalCrypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  // RFC 4122 v4
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0"));
  return `${hex[0]}${hex[1]}${hex[2]}${hex[3]}-${hex[4]}${hex[5]}-${hex[6]}${hex[7]}-${hex[8]}${hex[9]}-${hex[10]}${hex[11]}${hex[12]}${hex[13]}${hex[14]}${hex[15]}`;
}

