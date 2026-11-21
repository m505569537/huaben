/* ============================================================
   《未命名》 —— 剧本模板
   ------------------------------------------------------------
   用法：
     cp -r templates/new-game games/你的游戏id      # id 用英文小写
     ./serve.sh 你的游戏id
   然后把下面全改掉。

   格式说明见 docs/story-format.md
   ============================================================ */

const STORY = {
  meta: {
    title: '未命名',
    subtitle: '一句话勾住人。',
    tagline: '题材 · 题材 · 多结局',
    version: '0.1',
  },

  // 数值条。max 决定进度条满格，也是硬上限
  stats: [
    { key: '好感', init: 0, min: 0, max: 20, color: '#d3b073' },
    { key: '金钱', init: 50, min: 0, max: 300, color: '#a9906a' },
  ],

  start: 'a1',

  nodes: {
    a1: {
      chapter: '第一章 · 开端',
      text: `正文写在这里。空行就是分段。

建议每个节点 120–220 字。超过 250 字手机上要滚动，节奏就散了。`,
      choices: [
        { text: '第一个选项', next: 'a2', effect: { 好感: 2 } },
        { text: '第二个选项', next: 'a3', effect: { 金钱: -20, flags: ['钥匙'] } },
      ],
    },

    a2: {
      chapter: '第一章 · 开端',
      text: `第一个选项的结果。`,
      next: 'z1',
      effect: { 好感: 1 },
    },

    a3: {
      chapter: '第一章 · 开端',
      text: `第二个选项的结果。`,
      next: 'z1',
    },

    // 最终抉择：用条件锁区分结局
    z1: {
      chapter: '最终章 · 抉择',
      text: `做决定吧。

注意：每个决策节点必须留一条**不带 require** 的选项兜底，否则玩家可能卡死。`,
      choices: [
        {
          text: '带着钥匙走。',
          next: 'end_good',
          require: "has('钥匙') && 金钱>=30",
          hint: '需 钥匙 · 金钱 30',
        },
        { text: '留下来。', next: 'end_bad' },
      ],
    },

    end_good: {
      ending: {
        title: '好结局',
        label: '结局 · 一',
        rank: '甲',
        text: `结局正文。\n\n这里可以放很长，结局页会滚动。`,
        comment: '一句话点评，显示在结局卡最下面。',
      },
    },

    end_bad: {
      ending: {
        title: '坏结局',
        label: '结局 · 二',
        rank: '下',
        text: `结局正文。`,
        comment: '一句话点评。',
      },
    },
  },
};
