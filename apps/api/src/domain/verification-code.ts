import { CODE_ALPHABET, formatVerificationCode } from "@catalog/contracts";

/**
 * Genere un code de verification imprevisible.
 * Le code est la preuve opposable du paiement : il doit etre impossible a
 * deviner, et lisible au telephone (alphabet sans caracteres ambigus).
 */
export function generateVerificationCode(randomBytes: (n: number) => Uint8Array): string {
  const N = CODE_ALPHABET.length;
  // Rejet des valeurs qui biaiseraient le modulo.
  const limit = Math.floor(256 / N) * N;
  const out: string[] = [];
  while (out.length < 8) {
    for (const byte of randomBytes(16)) {
      if (byte >= limit) continue;
      out.push(CODE_ALPHABET[byte % N] as string);
      if (out.length === 8) break;
    }
  }
  return formatVerificationCode(out.join(""));
}
