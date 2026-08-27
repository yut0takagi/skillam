import { contextBridge } from 'electron'

const apiBaseUrl = process.argv.find((arg) => arg.startsWith('--api-base-url='))?.split('=')[1]

contextBridge.exposeInMainWorld('skillam', {
  apiBaseUrl: apiBaseUrl ?? 'http://127.0.0.1:4317'
})
