import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.teamhaim.app',
  appName: 'Team Haim',
  webDir: 'out',
  server: {
    url: 'https://team-haim-app2.vercel.app',
    cleartext: false,
  },
};

export default config;
