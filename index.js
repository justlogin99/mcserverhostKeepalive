const mineflayer = require('mineflayer');
const http = require('http');

/**
 * ==========================================
 * 全局参数集中配置 (按需直接修改此处)
 * ==========================================
 */
const CONFIG = {
    // 游戏版本与连接
    VERSION: '1.21.11',
    CHECK_TIMEOUT_INTERVAL: 60 * 1000,   // Mineflayer 内部协议超时时间

    // 心跳看门狗（防假死）
    WATCHDOG_TIMEOUT: 30 * 1000,         // 超过此时长未收到 time 数据包判定假死 (毫秒)
    WATCHDOG_CHECK_INTERVAL: 5 * 1000,   // 看门狗轮询检查频率 (毫秒)

    // 重连控制
    RECONNECT_DELAY: 15 * 1000,          // 断线重连等待冷却 (毫秒)
    RECONNECT_DEBOUNCE: 5 * 1000,        // 重连防抖间隔，防止短时并发触发 (毫秒)

    // 进服初始化
    SPAWN_INIT_DELAY: 3 * 1000,          // 进服后等待地图加载完成再发指令的延迟 (毫秒)
    INIT_COMMANDS: [
        '/gamemode creative',
        '/tp 0 80 0',
        '/difficulty peaceful'
    ],

    // 防挂机动作（跳跃）
    JUMP_INTERVAL: 4 * 60 * 1000,        // 跳跃防挂机周期 (毫秒)
    JUMP_PRESS_DURATION: 500,            // 跳跃按键保持时长 (毫秒)

    // 随机走动（带避障）
    MOVE_INTERVAL: 8 * 1000,             // 每隔多久尝试走一次 (毫秒)
    MOVE_MAX_TIME: 3000,                 // 单次最多走多久 (毫秒)
    WANDER_CENTER_X: 0,                  // 活动中心 X（应与 /tp 坐标对应）
    WANDER_CENTER_Z: 0,                  // 活动中心 Z
    WANDER_RADIUS: 15,                   // 活动半径 (格)

    // 定时清理掉落物
    CLEAR_INTERVAL: 60 * 60 * 1000,      // 掉落物清理周期 (毫秒)
    CLEAR_COMMAND: '/kill @e[type=item]',

    // 死亡处理
    RESPAWN_DELAY: 2 * 1000,             // 死亡后延迟复活时间 (毫秒)

    // 启动错峰
    START_INITIAL_DELAY: 30 * 1000,      // 首个账号启动等待延迟 (毫秒)
    START_STAGGER_DELAY: 10 * 1000       // 每个账号递增错峰延迟 (毫秒)
};

// 走动时视为危险的方块（名称包含即判定）
const DANGEROUS_BLOCKS = [
    'lava', 'water', 'fire', 'cactus', 'magma_block',
    'sweet_berry_bush', 'cobweb', 'powder_snow', 'campfire', 'wither_rose'
];

/**
 * ==========================================
 * 1. HTTP 服务（用于 Render 外部探活）
 * ==========================================
 */
const server = http.createServer((req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8'
    });
    res.end(
        'KeepAliveBot 系统状态：管理员模式已激活\n' +
        '当前状态：持续保活中...'
    );
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`✅ HTTP 服务已启动，端口: ${PORT}`);
});

/**
 * ==========================================
 * 2. 多账号列表配置
 * ==========================================
 */
const accounts = [
    {
        name: 'russ',
        host: '15.204.102.206',
        port: 13423,
        username: 'russ'
    }//,
    //{
        //name: 'rose',
        //host: '57.128.141.201',
        //port: 13628,
        //username: 'rose'
    //}
];

/**
 * ==========================================
 * 3. Bot 控制器
 * ==========================================
 */
const bots = new Map();

class MinecraftBot {
    constructor(config) {
        this.name = config.name;
        this.host = config.host;
        this.port = config.port;
        this.username = config.username;

        this.bot = null;

        // 定时器引用句柄
        this.jumpInterval = null;
        this.clearItemInterval = null;
        this.moveInterval = null;
        this.spawnTimeout = null;
        this.reconnectTimeout = null;
        this.watchdogInterval = null;
        this.walkTimer = null;

        // 状态监控
        this.lastPacketTime = 0;
        this.isReconnecting = false;
        this.isShuttingDown = false;
        this.lastReconnectTime = 0;
        this.walking = false;
    }

    /**
     * 停止走动并松开前进键
     */
    stopWalking() {
        if (this.walkTimer) {
            clearTimeout(this.walkTimer);
            this.walkTimer = null;
        }
        this.walking = false;
        if (this.bot) {
            try { this.bot.setControlState('forward', false); } catch (e) {}
        }
    }

    /**
     * 清理游戏内周期任务（不含重连定时器）
     */
    stopGameTasks() {
        if (this.jumpInterval) {
            clearInterval(this.jumpInterval);
            this.jumpInterval = null;
        }
        if (this.clearItemInterval) {
            clearInterval(this.clearItemInterval);
            this.clearItemInterval = null;
        }
        if (this.moveInterval) {
            clearInterval(this.moveInterval);
            this.moveInterval = null;
        }
        if (this.spawnTimeout) {
            clearTimeout(this.spawnTimeout);
            this.spawnTimeout = null;
        }
        if (this.watchdogInterval) {
            clearInterval(this.watchdogInterval);
            this.watchdogInterval = null;
        }
        this.stopWalking();
    }

    /**
     * 彻底重置并注销所有运行中的定时器
     */
    stopTasks() {
        this.stopGameTasks();
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }
    }

    /**
     * 判断朝 (dx, dz) 走一格是否安全
     */
    isSafeStep(dx, dz) {
        if (!this.bot || !this.bot.entity) return false;
        const base = this.bot.entity.position.floored();

        const ground = this.bot.blockAt(base.offset(dx, -1, dz));
        const feet = this.bot.blockAt(base.offset(dx, 0, dz));
        const head = this.bot.blockAt(base.offset(dx, 1, dz));
        if (!ground || !feet || !head) return false;

        // 脚下必须有实心方块（防掉坑）
        if (ground.boundingBox !== 'block') return false;
        // 脚下不能是危险方块
        if (DANGEROUS_BLOCKS.some((n) => ground.name.includes(n))) return false;
        // 前方脚部、头部不能有墙
        if (feet.boundingBox !== 'empty' || head.boundingBox !== 'empty') return false;
        // 不能走进水/岩浆等
        if (DANGEROUS_BLOCKS.some((n) => feet.name.includes(n))) return false;
        if (DANGEROUS_BLOCKS.some((n) => head.name.includes(n))) return false;

        return true;
    }

    /**
     * 随机选一个安全方向走一小段
     */
    wander() {
        if (this.walking || !this.bot || !this.bot.entity || this.isReconnecting) return;

        const pos = this.bot.entity.position;
        const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => {
            const nx = pos.x + dx - CONFIG.WANDER_CENTER_X;
            const nz = pos.z + dz - CONFIG.WANDER_CENTER_Z;
            return Math.abs(nx) <= CONFIG.WANDER_RADIUS &&
                   Math.abs(nz) <= CONFIG.WANDER_RADIUS &&
                   this.isSafeStep(dx, dz);
        });
        if (dirs.length === 0) return;

        const [dx, dz] = dirs[Math.floor(Math.random() * dirs.length)];
        const yaw = Math.atan2(-dx, -dz);
        this.walking = true;

        this.bot.look(yaw, 0, true).then(() => {
            if (!this.bot || !this.walking) { this.walking = false; return; }
            this.bot.setControlState('forward', true);
            const startTime = Date.now();

            const tick = () => {
                const p = this.bot && this.bot.entity && this.bot.entity.position;
                const outOfRange = p && (
                    Math.abs(p.x - CONFIG.WANDER_CENTER_X) > CONFIG.WANDER_RADIUS ||
                    Math.abs(p.z - CONFIG.WANDER_CENTER_Z) > CONFIG.WANDER_RADIUS);

                // 超时、断线、前方不安全、超出范围 → 停下
                if (!this.bot || this.isReconnecting ||
                    Date.now() - startTime > CONFIG.MOVE_MAX_TIME ||
                    outOfRange || !this.isSafeStep(dx, dz)) {
                    this.stopWalking();
                    return;
                }
                this.walkTimer = setTimeout(tick, 100);
            };
            tick();
        }).catch(() => { this.walking = false; });
    }

    /**
     * 实例构建与事件装载
     */
    create() {
        if (this.isShuttingDown) return;

        // 启动前先将遗留任务与旧连接清空
        this.stopTasks();

        if (this.bot) {
            console.log(`⚠️ [${this.username}] 检测到旧实例残留，强制回收中...`);
            try {
                this.bot.removeAllListeners();
                this.bot.end();
            } catch (e) {}
            this.bot = null;
        }

        console.log('');
        console.log('==========================================');
        console.log(`🛡️ 正在启动账号: ${this.username}`);
        console.log(`🌐 目标服务器: ${this.host}:${this.port}`);
        console.log('==========================================');

        try {
            this.bot = mineflayer.createBot({
                host: this.host,
                port: this.port,
                username: this.username,
                version: CONFIG.VERSION,
                auth: 'offline',
                checkTimeoutInterval: CONFIG.CHECK_TIMEOUT_INTERVAL
            });
        } catch (err) {
            console.log(`❌ [${this.username}] 实例创建异常:`, err.message);
            this.reconnect('实例创建阶段报错');
            return;
        }

        // 网络断开与踢出事件（单次触发即可）
        this.bot.once('kicked', (reason) => {
            this.reconnect(`被服务器踢出: ${JSON.stringify(reason)}`);
        });

        this.bot.once('end', () => {
            this.reconnect('网络连接终止 (end)');
        });

        this.bot.once('error', (err) => {
            this.reconnect(`网络异常: ${err.message}`);
        });

        // 核心心跳检测点：服务端运转时每秒下发一次 time 包
        this.bot.on('time', () => {
            this.lastPacketTime = Date.now();
        });

        // 进入游戏成功（死亡复活后也会再次触发）
        this.bot.on('spawn', () => {
            console.log(`✅ [${this.username}] 已成功进入 Minecraft！`);
            this.isReconnecting = false;
            this.lastPacketTime = Date.now();

            // 先清掉旧定时器，避免复活后任务叠加
            this.stopGameTasks();

            // 1. 进服指令初始化
            this.spawnTimeout = setTimeout(() => {
                if (!this.bot || !this.bot.entity) return;

                CONFIG.INIT_COMMANDS.forEach((cmd) => {
                    try {
                        this.bot.chat(cmd);
                    } catch (err) {
                        console.log(`⚠️ [${this.username}] 指令 [${cmd}] 发送失败:`, err.message);
                    }
                });
                console.log(`🛡️ [${this.username}] 环境初始化指令执行完成`);
            }, CONFIG.SPAWN_INIT_DELAY);

            // 2. 防 AFK 踢出跳跃
            this.jumpInterval = setInterval(() => {
                if (this.bot && this.bot.entity && !this.isReconnecting) {
                    try {
                        this.bot.setControlState('jump', true);
                        setTimeout(() => {
                            if (this.bot && !this.isReconnecting) {
                                try {
                                    this.bot.setControlState('jump', false);
                                } catch (e) {}
                            }
                        }, CONFIG.JUMP_PRESS_DURATION);

                        console.log(`🚶 [${this.username}] 执行防休眠动作：跳跃`);
                    } catch (err) {
                        console.log(`⚠️ [${this.username}] 跳跃异常:`, err.message);
                    }
                }
            }, CONFIG.JUMP_INTERVAL);

            // 3. 随机走动（带避障）
            this.moveInterval = setInterval(() => this.wander(), CONFIG.MOVE_INTERVAL);

            // 4. 定时清理掉落物
            this.clearItemInterval = setInterval(() => {
                if (this.bot && this.bot.entity && !this.isReconnecting) {
                    try {
                        this.bot.chat(CONFIG.CLEAR_COMMAND);
                        console.log(`🧹 [${this.username}] 已执行掉落物清理`);
                    } catch (err) {
                        console.log(`⚠️ [${this.username}] 清理掉落物失败:`, err.message);
                    }
                }
            }, CONFIG.CLEAR_INTERVAL);

            // 5. 假死看门狗（替代 TCP 端口探测，防端口扫描拦截）
            this.watchdogInterval = setInterval(() => {
                if (this.isShuttingDown || this.isReconnecting) return;

                const silentTime = Date.now() - this.lastPacketTime;
                if (silentTime > CONFIG.WATCHDOG_TIMEOUT) {
                    console.log(`🚨 [${this.username}] 超过 ${CONFIG.WATCHDOG_TIMEOUT / 1000} 秒未收到服务端心跳`);
                    this.reconnect('服务端假死或底层连接静默中断');
                }
            }, CONFIG.WATCHDOG_CHECK_INTERVAL);
        });

        // 死亡复活机制
        this.bot.on('death', () => {
            console.log(`💀 [${this.username}] 角色死亡，${CONFIG.RESPAWN_DELAY / 1000} 秒后尝试复活...`);
            this.stopWalking();
            setTimeout(() => {
                if (this.bot && this.bot.respawn) {
                    try {
                        this.bot.respawn();
                    } catch (err) {
                        console.log(`⚠️ [${this.username}] 复活请求异常:`, err.message);
                    }
                }
            }, CONFIG.RESPAWN_DELAY);
        });
    }

    /**
     * 重连控制流程
     */
    reconnect(reason) {
        if (this.isShuttingDown || this.isReconnecting) return;

        // 防抖：防止多个断开事件短时间连环触发
        const now = Date.now();
        if (now - this.lastReconnectTime < CONFIG.RECONNECT_DEBOUNCE) return;
        this.lastReconnectTime = now;

        this.isReconnecting = true;

        console.log('');
        console.log(`⚠️ [${this.username}] 连接断开`);
        console.log(`原因: ${reason}`);

        // 清理当前任务，防止旧定时器掐死新连接
        this.stopTasks();

        // 安全销毁 Socket 实例
        if (this.bot) {
            try {
                this.bot.on('error', () => {}); // 吸收注销过程中的网络重置错误
                this.bot.removeAllListeners();
                this.bot.end();
            } catch (e) {}
            this.bot = null;
        }

        console.log(`⏳ [${this.username}] 将在 ${CONFIG.RECONNECT_DELAY / 1000} 秒后尝试重连...`);

        this.reconnectTimeout = setTimeout(() => {
            this.reconnectTimeout = null;
            if (this.isShuttingDown) return;

            this.isReconnecting = false;
            this.create();
        }, CONFIG.RECONNECT_DELAY);
    }

    /**
     * 容器安全退出
     */
    shutdown() {
        if (this.isShuttingDown) return;
        this.isShuttingDown = true;

        console.log(`🛑 [${this.username}] 正在安全下线...`);
        this.stopTasks();

        if (this.bot) {
            try {
                this.bot.on('error', () => {});
                this.bot.quit();
                console.log(`✅ [${this.username}] 已正常登出游戏`);
            } catch (err) {
                console.log(`⚠️ [${this.username}] 登出时发生异常:`, err.message);
            }
            this.bot = null;
        }
    }
}

/**
 * ==========================================
 * 4. 账号按计划错峰启动
 * ==========================================
 */
accounts.forEach((config, index) => {
    const bot = new MinecraftBot(config);
    bots.set(config.name, bot);

    const delay = CONFIG.START_INITIAL_DELAY + index * CONFIG.START_STAGGER_DELAY;
    console.log(`⏳ [${config.username}] 将在 ${delay / 1000} 秒后开始连接`);

    setTimeout(() => {
        bot.create();
    }, delay);
});

/**
 * ==========================================
 * 5. 系统关闭信号截获（Render 优雅停机）
 * ==========================================
 */
const gracefulShutdown = (signal) => {
    console.log(`\n🛑 捕获到停机信号: ${signal}，开始释放全部连接资源...`);

    for (const bot of bots.values()) {
        bot.shutdown();
    }

    server.close(() => {
        console.log('✅ 内部 HTTP 服务已注销');
        process.exit(0);
    });

    setTimeout(() => {
        process.exit(0);
    }, 5000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
