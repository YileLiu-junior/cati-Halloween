# -*- coding: utf-8 -*-
"""万圣节猫咪人格测试 · 角色平衡自检脚本（v2：选项直接给角色加分）

用法: python balance-check.py
匹配 = 每个选项给若干角色直接加分，总分最高者胜（平局按 TIE_BREAK 顺序）。
属性六轴照常计分，但只用于结果卡展示，不参与匹配。
修改数据后重跑，检查三件事：
1. 16 个角色是否都会被匹配到（不存在"永远抽不中"的角色）
2. 占比是否均衡（没有一家独大）
3. 随机模拟的六维分布是否合理（结果卡属性条不会千篇一律）
"""

import random
import statistics
from collections import Counter

AXES = ["E", "A", "B", "D", "F", "C"]
AXIS_NAMES = {"E": "电量", "A": "贴贴", "B": "胆量", "D": "戏精", "F": "干饭", "C": "好奇"}

# 每题 4 个选项：(轴加点, [(角色id, 角色分), ...])；每轴起始 5 分，累加后夹在 0~10
# 顺序与 quiz-design.md 中的题目一一对应
QUESTIONS = [
    [  # Q1 下班开门
        (("A", +3), [("nurse", 2), ("bride", 1), ("zombie", 1)]),
        (("B", -3), [("mummy", 2), ("ghost", 1)]),
        (("A", -3), [("vampire", 2), ("pharaoh", 1)]),
        (("E", -3), [("gargoyle", 2), ("pharaoh", 1), ("bat", 1)]),
    ],
    [  # Q2 开饭时刻
        (("F", +3), [("pumpkin", 3)]),
        (("F", -3), [("pharaoh", 2), ("vampire", 1), ("witch", 1)]),
        (("A", +3), [("nurse", 2), ("ghost", 1)]),
        (("E", +3), [("zombie", 2), ("clown", 1)]),
    ],
    [  # Q3 半夜的你家
        (("E", +3), [("werewolf", 3), ("zombie", 1), ("chainsaw", 1)]),
        (("A", +3), [("bride", 2), ("nurse", 1)]),
        (("C", +3), [("witch", 3), ("franken", 1)]),
        (("B", +3), [("bat", 2), ("pirate", 1), ("clown", 1)]),
    ],
    [  # Q4 新东西出现
        (("C", +3), [("mummy", 2), ("franken", 1)]),
        (("B", -3), [("ghost", 2), ("mummy", 1)]),
        (("E", +3), [("chainsaw", 2), ("zombie", 1), ("pirate", 1)]),
        (("C", -3), [("vampire", 2), ("gargoyle", 1)]),
    ],
    [  # Q5 像人时刻
        (("C", +3), [("franken", 2), ("pharaoh", 1), ("witch", 1)]),
        (("A", +3), [("nurse", 2), ("bride", 1)]),
        (("E", +3), [("werewolf", 2), ("clown", 1), ("chainsaw", 1)]),
        (("D", -3), [("gargoyle", 2), ("vampire", 1)]),
    ],
    [  # Q6 摸摸敏感度
        (("A", +3), [("nurse", 2), ("pumpkin", 1)]),
        (("D", +3), [("bride", 2), ("ghost", 1)]),
        (("B", -3), [("mummy", 2), ("ghost", 1)]),
        (("A", -3), [("vampire", 2), ("pharaoh", 1), ("bat", 1)]),
    ],
    [  # Q7 玩耍风格
        (("E", +3), [("chainsaw", 2), ("zombie", 1), ("werewolf", 1)]),
        (("F", +3), [("pumpkin", 2), ("pirate", 1)]),
        (("E", -3), [("gargoyle", 2), ("bat", 1)]),
        (("D", +3), [("clown", 2), ("witch", 1)]),
    ],
    [  # Q8 抢地盘
        (("B", +3), [("pharaoh", 2), ("pirate", 1)]),
        (("F", +3), [("pumpkin", 2), ("werewolf", 1)]),
        (("C", +3), [("franken", 2), ("witch", 1)]),
        (("A", -3), [("bat", 2), ("vampire", 1)]),
    ],
    [  # Q9 外出体检
        (("D", +3), [("clown", 2), ("bride", 1)]),
        (("B", +3), [("gargoyle", 2), ("pirate", 1)]),
        (("B", -3), [("ghost", 2), ("mummy", 1)]),
        (("C", +3), [("pirate", 3), ("franken", 1)]),
    ],
    [  # Q10 镜头感
        (("D", +3), [("bride", 2), ("clown", 1)]),
        (("E", +3), [("zombie", 2), ("chainsaw", 1)]),
        (("D", -3), [("gargoyle", 1), ("bat", 1), ("witch", 1)]),
        (("C", +3), [("franken", 2), ("witch", 1)]),
    ],
]

CH_NAMES = {
    "ghost": "乖巧内向的小幽灵咪", "zombie": "活蹦乱跳的小僵尸咪", "chainsaw": "恶魔大爆发的电锯咪",
    "mummy": "爱躲藏的木乃伊咪", "nurse": "贴心依赖的小护士咪", "vampire": "个性魅力的吸血鬼咪",
    "franken": "有自己想法的科学怪咪", "pirate": "行侠仗义的海盗咪", "clown": "调皮捣蛋的小丑咪",
    "bride": "月光新娘咪", "witch": "神秘莫测的女巫咪", "pumpkin": "圆滚滚的南瓜咕噜咪",
    "werewolf": "月圆变身的狼人咪", "bat": "昼伏夜出的蝙蝠咪", "gargoyle": "稳重如山的石像鬼咪",
    "pharaoh": "傲娇的法老王咪",
}

# 平局时的优先顺序（撞分时取靠前的）
TIE_BREAK = ["chainsaw", "pumpkin", "ghost", "nurse", "pirate", "clown", "franken",
             "witch", "werewolf", "bat", "vampire", "pharaoh", "gargoyle", "mummy",
             "zombie", "bride"]


def score(picks):
    """picks: 每题选中的选项元组列表 → (角色分表, 六维属性向量)"""
    chars = Counter({cid: 0 for cid in CH_NAMES})
    axis = {a: 5.0 for a in AXES}
    for (axis_delta, char_pts) in picks:
        a, d = axis_delta
        axis[a] += d
        for cid, pts in char_pts:
            chars[cid] += pts
    vec = [max(0.0, min(10.0, axis[a])) for a in AXES]
    return chars, vec


def match(chars):
    best = max(TIE_BREAK, key=lambda cid: chars[cid])
    return best


def simulate(n, rng, first_bias=0.0, shuffle=False):
    tally = Counter()
    axis_sums = []
    for _ in range(n):
        picks = []
        for opts in QUESTIONS:
            view = list(opts)
            if shuffle:
                rng.shuffle(view)
            if first_bias and rng.random() < first_bias:
                picks.append(view[0])
            else:
                picks.append(view[rng.randrange(len(view))])
        chars, vec = score(picks)
        tally[match(chars)] += 1
        axis_sums.append(vec)
    return tally, axis_sums


def report(title, tally, n, axis_sums):
    print(f"\n== {title}（n={n}）==")
    shares = {cid: tally.get(cid, 0) / n * 100 for cid in CH_NAMES}
    for cid in sorted(CH_NAMES, key=lambda c: -shares[c]):
        print(f"  {shares[cid]:5.1f}%  {CH_NAMES[cid]}")
    lo, hi = min(shares.values()), max(shares.values())
    missing = [CH_NAMES[c] for c in CH_NAMES if shares[c] == 0]
    print(f"  --- 最低 {lo:.1f}% / 最高 {hi:.1f}%" + (f" / 抽不中: {missing}" if missing else " / 全部可达"))
    means = [statistics.mean(v[i] for v in axis_sums) for i in range(6)]
    stds = [statistics.pstdev(v[i] for v in axis_sums) for i in range(6)]
    print("  属性均值:", {AXIS_NAMES[a]: round(m, 1) for a, m in zip(AXES, means)})
    print("  属性波动:", {AXIS_NAMES[a]: round(s, 1) for a, s in zip(AXES, stds)})


if __name__ == "__main__":
    rng = random.Random(42)
    N = 20000
    t, ax = simulate(N, rng)
    report("纯随机作答", t, N, ax)
    t, ax = simulate(N, rng, shuffle=True)
    report("纯随机作答+选项洗牌", t, N, ax)
    t, ax = simulate(N, rng, first_bias=0.40, shuffle=True)
    report("首选项偏好40%+选项洗牌", t, N, ax)
