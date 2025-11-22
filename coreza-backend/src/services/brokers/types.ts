export interface BrokerInput {
  user_id: string;
  credential_id: string;
  operation: string;
  [key: string]: any;
}

export interface BrokerResult {
  success: boolean;
  data?: any;
  error?: string;
}

export interface BrokerCredentials {
  api_key: string;
  secret_key?: string;
  paper_trading?: boolean;
  [key: string]: any;
}

export interface IBrokerService {
  /** e.g. "alpaca", "dhan" */
  readonly brokerKey: string;
  execute(input: BrokerInput): Promise<BrokerResult>;
}