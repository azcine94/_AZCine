// Browser host adapter: upstream dictionaries, without Plainva's app bootstrap.
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './vendor/packages/ui/src/locales/en.json';
import zh from './vendor/packages/ui/src/locales/zh-CN.json';
export const i18nReady = i18n.use(initReactI18next).init({
  lng: 'zh-CN', fallbackLng: 'en', initImmediate: false,
  resources: { en: { translation: en }, 'zh-CN': { translation: zh } },
  interpolation: { escapeValue: false },
});
export default i18n;
