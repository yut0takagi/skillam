import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // src だけを対象にする。指定しないと、ビルド後に dist/ 配下の
    // コンパイル済みテストまで拾い、件数が倍になって古い成果物が
    // 通ったように見える。
    include: ['src/**/*.test.ts']
  }
})
