import { Redis } from 'ioredis';

declare global {
  namespace Express {
    interface Request {
      redis: Redis;
    }
  }
}