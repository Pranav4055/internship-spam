import mongoose from 'mongoose';
import { DetectionRule } from '../models/DetectionRule.js';
import { RuleDataUnavailableError } from './ruleDataError.js';

export async function loadDetectionRules() {
  if (mongoose.connection.readyState !== mongoose.Connection.STATES.connected) {
    throw new RuleDataUnavailableError();
  }
  try {
    return await DetectionRule.find({}).lean().exec();
  } catch {
    throw new RuleDataUnavailableError();
  }
}
