/**
 * The Mongo driver and bcrypt come from the API's own dependency tree (mongoose → mongodb, core → bcryptjs),
 * so this package adds only Playwright to the lockfile and always speaks the same driver version as the API.
 */
import { createRequire } from 'node:module';
import path from 'node:path';

import { API_DIR, REPO_DIR } from './env';

const apiRequire = createRequire(path.join(API_DIR, 'package.json'));
const mongooseRequire = createRequire(apiRequire.resolve('mongoose'));
const coreRequire = createRequire(path.join(REPO_DIR, 'packages', 'core', 'package.json'));

/* eslint-disable @typescript-eslint/no-explicit-any */
export const mongodb: { MongoClient: any } = mongooseRequire('mongodb');
export const bcrypt: { hashSync(s: string, rounds: number): string } = coreRequire('bcryptjs');
