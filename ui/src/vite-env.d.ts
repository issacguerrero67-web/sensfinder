/// <reference types="vite/client" />

interface Window {
  __SF__?: { token: string; version: string };
  pywebview?: { api?: { minimize?: () => void; toggle_maximize?: () => void; close?: () => void } };
}
