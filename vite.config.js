import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { writeFileSync, mkdirSync } from 'fs'
import { resolve } from 'path'

const buildId = String(Date.now())

function writeVersion(dir) {
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(resolve(dir, 'version.json'), JSON.stringify({ v: buildId }))
  } catch (_) {}
}

export default defineConfig({
  define: {
    __BW_BUILD__: JSON.stringify(buildId),
  },
  plugins: [
    react(),
    {
      name: 'buildwatch-version',
      buildStart() {
        writeVersion(resolve(__dirname, 'public'))
      },
      closeBundle() {
        writeVersion(resolve(__dirname, 'dist'))
      },
    },
  ],
})
