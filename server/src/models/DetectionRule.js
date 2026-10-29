import mongoose from 'mongoose';

const detectionRuleSchema = new mongoose.Schema({
  ruleKey: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    match: /^[a-z0-9][a-z0-9._-]{1,79}$/,
  },
  category: {
    type: String,
    required: true,
    enum: ['content', 'header', 'url', 'company'],
  },
  severity: {
    type: String,
    required: true,
    enum: ['strong', 'moderate', 'weak'],
    default: 'weak',
  },
  description: { type: String, required: true, trim: true, maxlength: 300 },
  enabled: { type: Boolean, default: false },
  ruleVersion: { type: Number, required: true, min: 1, default: 1 },
  parameters: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
}, { timestamps: true, versionKey: false, autoIndex: false });

export const DetectionRule = mongoose.models.DetectionRule
  ?? mongoose.model('DetectionRule', detectionRuleSchema);
