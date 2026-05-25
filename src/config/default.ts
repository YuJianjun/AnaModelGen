export interface AnaModelGenConfig {
  modelFidelity: 'functional' | 'behavioral' | 'structural';
  svaCompat: 'vcs' | 'xcelium' | 'questa' | 'multi';
  svaSeverity: 'error' | 'warning' | 'info';
}

export const defaultConfig: AnaModelGenConfig = {
  modelFidelity: 'functional',
  svaCompat: 'multi',
  svaSeverity: 'error',
};
