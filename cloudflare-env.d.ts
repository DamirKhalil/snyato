declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    STUDIO_DROPBOX_FOLDER_JSON?: string;
    STUDIO_SYNC_TOKEN_SHA256?: string;
  }
}
