/** 화면에 그대로 보여줘도 되는 메시지를 가진 오류. structured.ts와 openai.ts가 함께 쓰므로 순환 import를 피하려고 따로 둔다. */
export class ClaudeCallError extends Error {}
