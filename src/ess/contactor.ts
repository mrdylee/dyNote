export type ContactorScenario = 'normal' | 'mismatch' | 'offline';
export type ContactorDiagnosis = 'pending' | 'normal' | 'mismatch' | 'unknown';

export function contactorPlaybackFrame(scenario: ContactorScenario, elapsedSeconds: number): {
  command: 'OPEN' | 'CLOSED';
  feedback: 'OPEN' | 'CLOSED' | 'UNKNOWN';
  diagnosis: ContactorDiagnosis | 'ready';
} {
  if (elapsedSeconds < .6) return { command: 'CLOSED', feedback: 'CLOSED', diagnosis: 'ready' };
  return simulateContactor(scenario, elapsedSeconds - .6);
}

export function simulateContactor(scenario: ContactorScenario, elapsedSeconds: number): {
  command: 'OPEN';
  feedback: 'OPEN' | 'CLOSED' | 'UNKNOWN';
  diagnosis: ContactorDiagnosis;
} {
  if (scenario === 'offline') return { command: 'OPEN', feedback: 'UNKNOWN', diagnosis: 'unknown' };
  if (scenario === 'normal' && elapsedSeconds >= .3) return { command: 'OPEN', feedback: 'OPEN', diagnosis: 'normal' };
  return { command: 'OPEN', feedback: 'CLOSED', diagnosis: scenario === 'mismatch' && elapsedSeconds > 1 ? 'mismatch' : 'pending' };
}
