import { mongo } from 'mongoose';

/** MongoDB rejected a write because a unique index already holds the value. */
export function isDuplicateKeyError(error: unknown): boolean {
  return error instanceof mongo.MongoServerError && error.code === 11000;
}
