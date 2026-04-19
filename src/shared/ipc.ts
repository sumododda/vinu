export const IpcChannels = {
  Ping: 'app:ping',
} as const;

export type Api = {
  ping(): Promise<'pong'>;
};

declare global {
  interface Window {
    api: Api;
  }
}
