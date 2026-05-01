function bytesToUuid(bytes: Uint8Array): string {
  const hex: string[] = [];
  for (let index = 0; index < bytes.length; index += 1) {
    hex.push(bytes[index].toString(16).padStart(2, "0"));
  }
  return (
    hex.slice(0, 4).join("") +
    "-" +
    hex.slice(4, 6).join("") +
    "-" +
    hex.slice(6, 8).join("") +
    "-" +
    hex.slice(8, 10).join("") +
    "-" +
    hex.slice(10, 16).join("")
  );
}

export function randomUUID(): string {
  const cryptoObject = (globalThis as unknown as { crypto?: Crypto }).crypto;
  const anyCrypto = cryptoObject as unknown as {
    randomUUID?: () => string;
    getRandomValues?: (array: Uint8Array) => Uint8Array;
  };

  if (anyCrypto?.randomUUID) {
    return anyCrypto.randomUUID();
  }

  if (anyCrypto?.getRandomValues) {
    const bytes = new Uint8Array(16);
    anyCrypto.getRandomValues(bytes);

    // RFC4122 v4
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    return bytesToUuid(bytes);
  }

  // Last resort (non-crypto), still OK for UI identifiers.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const rand = Math.random() * 16;
    const value = char === "x" ? rand : (rand & 0x3) | 0x8;
    return Math.floor(value).toString(16);
  });
}

