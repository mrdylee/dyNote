export type RackStatus = 'normal' | 'warning';

export interface RackTelemetry {
  rackId: number;
  temperatureC: number;
  voltageV: number;
  socPercent: number;
  sohPercent: number;
  currentA: number;
  state: 'CHARGING' | 'IDLE';
  status: RackStatus;
  diagnosticCode: 'NORMAL' | 'OVER_TEMPERATURE';
  diagnosticMessage: string;
}

export interface TelemetryProvider {
  readonly source: 'simulation' | 'modbus';
  read(containerId?: number): Promise<RackTelemetry[]>;
}

export interface EquipmentTelemetry {
  id: 'LCS' | 'eBSC';
  communication: 'ONLINE' | 'OFFLINE';
  mode: string;
  dsState?: 'OPEN' | 'CLOSED';
  diagnosticCode: 'NORMAL';
  diagnosticMessage: string;
}

export function telemetryStatus(temperatureC: number): RackStatus {
  return temperatureC >= 35 ? 'warning' : 'normal';
}

export function formatRackLabel(rackId: number): string {
  return `RACK ${String(rackId).padStart(2, '0')}`;
}

const sampleValues = [
  [27.4, 768.2, 82],
  [28.1, 766.8, 79],
  [29.6, 769.5, 85],
  [36.2, 764.1, 72],
  [30.3, 767.7, 77],
  [26.9, 770.0, 88],
] as const;

export class SampleTelemetryProvider implements TelemetryProvider {
  readonly source = 'simulation' as const;

  async read(containerId = 1): Promise<RackTelemetry[]> {
    return sampleValues.map(([temperatureC, voltageV, socPercent], index) => ({
      rackId: index + 1,
      temperatureC: temperatureC + (containerId - 1) * .4,
      voltageV: voltageV - (containerId - 1) * 1.2,
      socPercent: socPercent - (containerId - 1) * 3,
      sohPercent: 98 - index * 0.3 - (containerId - 1) * .2,
      currentA: index === 3 ? 0 : 24.5 + index + (containerId - 1) * 2,
      state: index === 3 ? 'IDLE' : 'CHARGING',
      status: telemetryStatus(temperatureC + (containerId - 1) * .4),
      diagnosticCode: temperatureC + (containerId - 1) * .4 >= 35 ? 'OVER_TEMPERATURE' : 'NORMAL',
      diagnosticMessage: temperatureC + (containerId - 1) * .4 >= 35 ? '랙 내부 온도 상한 초과' : '진단 이상 없음',
    }));
  }

  async readEquipment(containerId = 1): Promise<EquipmentTelemetry[]> {
    return [
      { id: 'LCS', communication: 'ONLINE', mode: 'AUTO', dsState: 'CLOSED', diagnosticCode: 'NORMAL', diagnosticMessage: `ESS ${String(containerId).padStart(2, '0')} · 랙 데이터 수집 정상` },
      { id: 'eBSC', communication: 'ONLINE', mode: 'MONITORING', diagnosticCode: 'NORMAL', diagnosticMessage: `ESS ${String(containerId).padStart(2, '0')} · LAN 4채널 통신 정상` },
    ];
  }
}
