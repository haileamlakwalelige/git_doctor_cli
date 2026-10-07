export class GitDoctorError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 2) {
    super(message);
    this.name = 'GitDoctorError';
    this.exitCode = exitCode;
  }
}
