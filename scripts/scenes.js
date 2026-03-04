(() => {
  const scenes = [
    {
      id: "s1",
      text: "To 我最爱的旅人————张玲悦\n\n我想带你走进一片安静的海面。\n海风不急，浪光刚好。",
      choiceLabel: "好，继续",
      next: "s2"
    },
    {
      id: "s2",
      text: "如果有一种颜色可以形容你在我心里的样子，\n大概是夜色里最温柔、最清澈的那一抹蓝。",
      choiceLabel: "再说一点",
      next: "s3"
    },
    {
      id: "s3",
      text: "你更想先听哪一种画面？",
      choices: [
        { label: "海边散步", next: "s4a" },
        { label: "窗前听雨", next: "s4b" }
      ]
    },
    {
      id: "s4a",
      text: "如果是海边散步，\n我会慢一点走，只为把你每个笑都记住。",
      choiceLabel: "再往下听",
      next: "s5",
      theme: "shore"
    },
    {
      id: "s4b",
      text: "如果是窗前听雨，\n我会把安静留给你，把心跳留给我自己。",
      choiceLabel: "再往下听",
      next: "s5",
      theme: "rain"
    },
    {
      id: "s5",
      text: "我最想给你的，不是热闹，\n是平安、健康，还有被好好珍惜的每一天。",
      choiceLabel: "我在听",
      next: "s6",
      theme: "default"
    },
    {
      id: "s6",
      text: "哪怕以后我们会去到不同远方，\n我也想把一份确定的心意，一直放在你身边。",
      choiceLabel: "那就继续",
      next: "s7",
      audioCue: "startFadeIn"
    },
    {
      id: "s7",
      text: "从这一刻开始，\n我想让这段话有一点旋律陪着你听。",
      choiceLabel: "嗯，继续",
      next: "s8"
    },
    {
      id: "s8",
      text: "我准备了很久，不只是今天这一分钟。\n是很多次想你时，慢慢攒起来的认真。",
      choiceLabel: "还有吗",
      next: "s9"
    },
    {
      id: "s9",
      text: "跟着这段旋律，只凭耳朵去感受，\n你先听见了哪一种心意？",
      choices: [
        { label: "像海一样透澈的蓝", next: "s10" },
        { label: "雨后空气般的清澈", next: "s10" },
        { label: "安静却很坚定的忠贞", next: "s10" },
        { label: "克制里藏着的炽热", next: "s10" },
        { label: "愿你平安健康的牵挂", next: "s10" }
      ]
    },
    {
      id: "s10",
      text: "如果有一天，我们站在斯里兰卡的海风里，\n我想牵着你，看那条被夕阳点亮的海岸线。",
      choiceLabel: "然后呢",
      next: "s11",
      theme: "shore",
      heroImage: "assets/sri-lanka-coast.png",
      heroAlt: "斯里兰卡海岸"
    },
    {
      id: "s11",
      text: "真相在这块屏幕的下方。\n你去探索吧。",
      choices: [{ label: "再听一遍", cameraAction: "openSystemCamera" }],
      theme: "default"
    }
  ];

  const sceneMap = Object.fromEntries(scenes.map((scene) => [scene.id, scene]));

  window.STORY_SCENES = {
    initialSceneId: "s1",
    scenes,
    sceneMap
  };
})();
