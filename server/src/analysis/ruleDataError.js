export class RuleDataUnavailableError extends Error {
  constructor() {
    super('Required detection rule data is unavailable.');
    this.name = 'RuleDataUnavailableError';
    this.code = 'RULE_DATA_UNAVAILABLE';
  }
}
