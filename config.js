// 設定檔：照「設定教學.md」一步一步填好。
// 沒填 firebaseConfig 時，App 會用「本機試用模式」，資料只存在這支手機的瀏覽器裡。

// 這些是 Firebase 的公開識別碼（不是密碼），放在網頁裡是正常的；資料安全靠 firestore.rules 保護。
export const firebaseConfig = {
  apiKey: 'AIzaSyBwh4mGhuZpw-TrjZnikHc6gBGv8sue2EM',
  authDomain: 'moving-app-ac208.firebaseapp.com',
  projectId: 'moving-app-ac208',
  appId: '1:814553133689:web:f280dcda158fb8a9da5aa8',
};

// Cloudflare Worker 的網址（Claude 解析用），例如 'https://moving-ai.你的帳號.workers.dev'
export const workerUrl = 'https://moving-ai.kk3414966.workers.dev';

// 官網後台：存內容、存照片的 Cloudflare Worker，以及照片放在 GitHub 的位置
export const siteWorkerUrl = 'https://moving-booking.kk3414966.workers.dev';
export const siteFilesBase = 'https://raw.githubusercontent.com/kk3414966-cmd/business-sites/main/moving/';

// Google Cloud OAuth 用戶端 ID（讀 Gmail 用），例如 '1234-abc.apps.googleusercontent.com'
export const googleClientId = '814553133689-17v8qg60fu6u5kmn6s8bgjtjfru77qtg.apps.googleusercontent.com';
