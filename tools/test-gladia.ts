import { runGladia } from './benchmark/runners/gladia.ts';

const sentence = { id: 'zh-01', text: '請問您今天哪裡不舒服？', lang: 'zh', langName: '中文', targetText: '' };
const result = await runGladia(
  sentence, 
  '/home/ubuntu/realtime_lab/tools/audio/zh-01.mp3', 
  'add7672b-2f8d-4da7-a90f-6f6b937d281d', 
  'en', 
  30000
);
console.log(JSON.stringify(result, null, 2));
