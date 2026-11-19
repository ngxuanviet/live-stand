import { Platform } from '../../shared/events.js';
import { TikTokConnector } from './tiktokConnector.js';
import { YouTubeConnector } from './youtubeConnector.js';

/** Đăng ký connector theo nền tảng. Thêm nền tảng mới: viết lớp kế thừa Connector và đăng ký ở đây. */
export function createConnector(source, config) {
  const base = { id: source.id, handle: source.handle };
  switch (source.platform) {
    case Platform.TIKTOK:
      return new TikTokConnector(base, { signApiKey: config.signApiKey, debugLog: config.tiktokDebugLog, extendedGiftInfo: config.tiktokExtendedGiftInfo });
    case Platform.YOUTUBE:
      return new YouTubeConnector(base);
    default:
      throw new Error(`Nền tảng không hỗ trợ: ${source.platform}`);
  }
}

export const SUPPORTED_PLATFORMS = [Platform.TIKTOK, Platform.YOUTUBE];
