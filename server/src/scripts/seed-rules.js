import mongoose from 'mongoose';
import { config } from '../config.js';
import { connectMongo } from '../db/connect.js';
import { diagnoseMongoError } from '../db/mongoDiagnostics.js';
import { DetectionRule } from '../models/DetectionRule.js';
import { seedRules } from '../db/seedRules.js';

if (!config.mongoSeedUri) {
  console.error('MONGODB_SEED_URI is required to seed detection rules.');
  process.exitCode = 1;
} else {
  try {
    await connectMongo(config.mongoSeedUri);
  } catch (error) {
    const diagnostic = diagnoseMongoError(error);
    console.error(`Could not connect to MongoDB [${diagnostic.code}]. ${diagnostic.message}`);
    process.exitCode = 1;
  }

  if (mongoose.connection.readyState === mongoose.Connection.STATES.connected) {
    try {
      await DetectionRule.createIndexes();
      const count = await seedRules();
      console.info(`Seeded ${count} starter detection rules (existing values preserved).`);
    } catch (error) {
      const diagnostic = diagnoseMongoError(error, { operation: 'seed' });
      console.error(`Could not seed detection rules [${diagnostic.code}]. ${diagnostic.message}`);
      process.exitCode = 1;
    }
  }

  try {
    await mongoose.disconnect();
  } catch {
    // Keep shutdown output free of driver details and credentials.
  }
}
