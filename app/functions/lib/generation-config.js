// 仅服务端读取。参考图先上传到私有 R2，再填写对象 key，不填写公开链接。
export const GENERATION_CONFIG = {
  model: "gpt-image-2",
  size: "1024x1024",
  prompt: "",
  referenceImageKeys: [],
};
