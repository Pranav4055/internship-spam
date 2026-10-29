import mongoose from 'mongoose';
import { config } from '../config.js';
import { diagnoseMongoError } from './mongoDiagnostics.js';

export async function connectMongo(uri = config.mongoUri) {
  return mongoose.connect(uri, {
    dbName: config.mongoDbName,
    serverSelectionTimeoutMS: 10000,
  });
}

export function getDatabaseStatus(readyState = mongoose.connection.readyState) {
  switch (readyState) {
    case 1: return 'connected';
    case 2: return 'connecting';
    default: return 'disconnected';
  }
}

export async function connectToDatabase() {
  if (!config.mongoUri) {
    console.warn('MongoDB is not configured; health checks will report it as disconnected.');
    return false;
  }

  try {
    await connectMongo();
    console.info('MongoDB connected.');
    return true;
  } catch (error) {
    const diagnostic = diagnoseMongoError(error);
    console.error(`MongoDB connection failed [${diagnostic.code}]. ${diagnostic.message}`);
    return false;
  }
}
