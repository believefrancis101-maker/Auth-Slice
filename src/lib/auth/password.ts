import bcrypt from "bcryptjs";

/**
 * Cost factor (salt rounds) for bcrypt hashing.
 * 12 provides a strong balance of brute-force resistance and server performance.
 */
const BCRYPT_COST_FACTOR = 12;

/**
 * Hashes a plaintext password using bcryptjs with cost factor 12.
 *
 * @param password Plaintext password to hash
 * @returns Promise resolving to the bcrypt hash string
 */
export async function hash(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST_FACTOR);
}

/**
 * Verifies a plaintext password against an existing bcrypt hash.
 *
 * @param password Plaintext password to check
 * @param hash Stored bcrypt hash string
 * @returns Promise resolving to true if password matches, false otherwise
 */
export async function verify(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
