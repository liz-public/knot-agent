import type { CliArgument, CliCommand } from './cli.js'

const command = (metadata: Omit<CliCommand, 'arguments'>, arguments_: readonly CliArgument[]): CliCommand => ({
  ...metadata,
  arguments: arguments_,
})

const textPosition = (name: string, description: string, required = true, label?: string): CliArgument =>
  ({ name, description, format: 'positional', required, type: 'text', ...(label === undefined ? {} : { label }) })
const enumPosition = (name: string, description: string, values: readonly string[], required = true): CliArgument =>
  ({ name, description, format: 'positional', required, type: 'enum', values })
const textFlag = (name: string, description: string, required = false, label?: string, flag?: string): CliArgument =>
  ({ name, description, format: 'flag', required, type: 'text', ...(label === undefined ? {} : { label }), ...(flag === undefined ? {} : { flag }) })
const enumFlag = (name: string, description: string, values: readonly string[], required = false, flag?: string): CliArgument =>
  ({ name, description, format: 'flag', required, type: 'enum', values, ...(flag === undefined ? {} : { flag }) })
const switchFlag = (name: string, description: string, flag?: string): CliArgument =>
  ({ name, description, format: 'switch', required: false, ...(flag === undefined ? {} : { flag }) })

export const ANDROID_TOOL_CATALOG: readonly CliCommand[] = [
  command({
    toolId: "contact", name: "contact", summary: "匹配联系人 -> candidates[]（不含号码）",
    description: "按姓名/称呼匹配通讯录。lookup 只查号不拨号；call 按姓名进入拨打流程（唯一命中可直拨，多候选返回列表后需 select）。候选列表不含号码，不要先查后dial；用户提供明确号码用 dial",
    examples: ["contact lookup 爸爸","contact lookup 李行素","contact call 张三","contact call 李哲"],
    keywords: ["联系人","查号","通讯录","打电话"],
  }, [
      enumPosition("sub", "联系人操作：lookup 仅查询，call 进入拨打流程。", ["lookup","call"]),
      textPosition("query", "联系人姓名或称呼。", true, "name")
    ]),
  command({
    toolId: "contact_add", name: "contact.add", summary: "存联系人",
    description: "按 phone 查找联系人：存在则更新 name，否则新建。",
    examples: ["contact.add 10086 中国移动"],
    keywords: ["保存联系人","新建联系人"],
  }, [
      textPosition("phone", "联系人电话号码。"),
      textPosition("name", "联系人姓名；包含空格时使用双引号。")
    ]),
  command({
    toolId: "contact_delete", name: "contact.delete", summary: "删联系人",
    description: "按 phone 删除通讯录联系人。",
    examples: ["contact.delete 10086"],
    keywords: ["删除联系人"],
  }, [
      textPosition("phone", "要删除的联系人电话号码。")
    ]),
  command({
    toolId: "dial", name: "dial", summary: "拨号",
    description: "拨打明确电话号码。联系人打电话请用 contact call。",
    examples: ["dial 10086"],
    keywords: ["拨号","回拨"],
  }, [
      textPosition("phone", "要拨打的明确电话号码。", true, "number")
    ]),
  command({
    toolId: "select", name: "select", summary: "选择候选 -> 执行结果",
    description: "选择已展示候选列表中的第 N 项，消费 contact / map 等工具暂存的 pending 列表。N 从 1 开始。",
    examples: ["select 1"],
    keywords: ["第一个","第二个","选第"],
  }, [
      textPosition("ordinal", "候选列表序号，从 1 开始。", true, "N")
    ]),
  command({
    toolId: "list_call_history", name: "call.log", summary: "通话记录 -> calls[]（含 number）",
    description: "查询本机通话记录（未接 / 呼入 / 拨出）。省略类型参数时默认 all；省略 --time_scope 时默认 today；按时间倒序。",
    examples: ["call.log","call.log missed","call.log all --time_scope last_7d","call.log missed --time_scope today --limit 50","call.log all --time_scope last_7d --groupby_ctype"],
    keywords: ["未接","通话记录","漏接"],
  }, [
      enumPosition("type", "通话类型，省略时默认 all。", ["all","missed","incoming","outgoing"], false),
      enumFlag("time_scope", "查询时间范围，省略时默认 today。", ["today","last_24h","last_7d"]),
      textFlag("limit", "最多返回的记录数。", false, "N"),
      switchFlag("groupby_ctype", "按通话类型分组返回。")
    ]),
  command({
    toolId: "reject_incoming_call", name: "hangup", summary: "[无参]挂断",
    description: "挂断当前来电。无来电或机型限制可能无效。",
    examples: ["hangup"],
    keywords: ["挂断","拒接"],
  }, []),
  command({
    toolId: "wechat_send", name: "wechat.send", summary: "微信发文字",
    description: "只传消息正文，打开微信「选择朋友」分享页；好友由用户在微信内选择并发送。不得传联系人姓名。",
    examples: ["wechat.send \"你好，明天见\"","wechat.send \"会议改到下午三点\""],
    keywords: ["微信发消息","微信发给"],
  }, [
      textPosition("text", "要分享的消息正文；包含空格时使用双引号。")
    ]),
  command({
    toolId: "list_sms_messages", name: "sms.list", summary: "列出短信 -> sms[]（含 ref_id）",
    description: "列出近期短信。",
    examples: ["sms.list","sms.list 50"],
    keywords: ["短信","收件箱"],
  }, [
      textPosition("limit", "最多返回的短信数。", false)
    ]),
  command({
    toolId: "send_sms", name: "sms.send", summary: "发短信",
    description: "向指定号码发送短信。",
    examples: ["sms.send 18811026772 今晚回家吃饭"],
    keywords: ["发短信"],
  }, [
      textPosition("phone", "收件人电话号码。"),
      textPosition("text", "短信正文；包含空格时使用双引号。")
    ]),
  command({
    toolId: "get_device_status", name: "device.status", summary: "查设备状态 -> fields[]",
    description: "只读查询本机状态。fields 可选：device|battery|storage|memory|network|bluetooth|brightness|volume|ringer|display|power|all，默认 all。仅用户明确询问设备状态时使用；调节亮度/音量/铃声时勿主动调用。",
    examples: ["device.status","device.status battery,storage"],
    keywords: ["电量","设备状态"],
  }, [
      textPosition("fields", "逗号分隔的状态字段；省略时默认 all。", false)
    ]),
  command({
    toolId: "set_stream_volume", name: "sys.volume", summary: "调音量",
    description: "调节音量。无符号 percent=绝对 0–100；+N 相对调大；-N 相对调小。stream 默认 music；用户明确说铃声音量才用 ring。",
    examples: ["sys.volume 80","sys.volume +20","sys.volume 50 --stream ring"],
    keywords: ["音量","调大","调小"],
  }, [
      textPosition("percent", "绝对百分比或 +N/-N 相对调节值。", true, "[+|-]percent"),
      enumFlag("stream", "音频流，省略时默认 music。", ["music","ring","alarm","notification"])
    ]),
  command({
    toolId: "set_ringer_mode", name: "sys.ringer", summary: "铃声模式",
    description: "设置铃声模式。ring=响铃，silent=静音，vibrate=振动。与 sys.dnd 不同。",
    examples: ["sys.ringer silent","sys.ringer ring","sys.ringer vibrate"],
    keywords: ["静音","振动","响铃"],
  }, [
      enumPosition("mode", "铃声模式。", ["ring","silent","vibrate"])
    ]),
  command({
    toolId: "set_do_not_disturb", name: "sys.dnd", summary: "勿扰",
    description: "开关系统勿扰（DND）。on 开启（priority 模式），off 关闭。",
    examples: ["sys.dnd on","sys.dnd off"],
    keywords: ["勿扰","免打扰"],
  }, [
      enumPosition("enabled", "on 开启勿扰，off 关闭勿扰。", ["on","off"])
    ]),
  command({
    toolId: "set_wifi_enabled", name: "sys.wifi", summary: "WiFi 开关",
    description: "开关 WiFi（无线网络）。仅 WiFi，不处理蓝牙、热点、移动数据。",
    examples: ["sys.wifi on","sys.wifi off"],
    keywords: ["WiFi","无线网络"],
  }, [
      enumPosition("enabled", "on 开启 WiFi，off 关闭 WiFi。", ["on","off"])
    ]),
  command({
    toolId: "set_screen_brightness", name: "sys.brightness", summary: "调亮度",
    description: "调节屏幕亮度。无符号 percent=绝对 0–100；+N 相对调亮；-N 相对调暗。会自动关闭自动亮度。",
    examples: ["sys.brightness 80","sys.brightness +30","sys.brightness -20"],
    keywords: ["亮度","调亮","调暗"],
  }, [
      textPosition("percent", "绝对百分比或 +N/-N 相对调节值。", true, "[+|-]percent")
    ]),
  command({
    toolId: "set_screen_rotation", name: "sys.rotation", summary: "屏幕旋转",
    description: "设置屏幕旋转方向。省略参数时默认 auto。",
    examples: ["sys.rotation auto","sys.rotation landscape","sys.rotation portrait"],
    keywords: ["旋转","横屏","竖屏"],
  }, [
      enumPosition("mode", "屏幕旋转方向，省略时默认 auto。", ["auto","portrait","landscape","reverse_portrait","reverse_landscape"], false)
    ]),
  command({
    toolId: "media_play_pause", name: "media.toggle", summary: "[无参]播放暂停",
    description: "向当前媒体会话发送播放/暂停键（toggle）。无法单独指定播放或暂停；是否生效取决于当前是否有活跃媒体会话。",
    examples: ["media.toggle"],
    keywords: ["播放","暂停"],
  }, []),
  command({
    toolId: "date", name: "date", summary: "日期时间 -> local_date/local_time",
    description: "获取当前时间或解析时间表达式。无参返回当前设备时间。支持 +3d、明天、06-15 14:00、2026-06-15 等表达式。",
    examples: ["date","date 明天","date +3d","date \"2026-06-13 14:00\""],
    keywords: ["几点","星期几"],
  }, [
      textPosition("expr", "日期时间表达式；包含空格时使用双引号。", false)
    ]),
  command({
    toolId: "set_alarm_clock", name: "alarm.set", summary: "设闹钟",
    description: "设置闹钟（时间点提醒或周期性闹钟）。倒计时或计时器用 timer。hour 必填；周期重复传 --repeat_weekdays（1=周一…7=周日）。",
    examples: ["alarm.set 7 30","alarm.set 7 30 --repeat_weekdays 1,2,3,4,5"],
    keywords: ["闹钟","起床"],
  }, [
      textPosition("hour", "小时，使用 24 小时制。"),
      textPosition("minute", "分钟，取值 0-59。"),
      textFlag("repeat_weekdays", "重复星期，1 表示周一、7 表示周日。", false, "1-7,...")
    ]),
  command({
    toolId: "show_alarm_clocks", name: "alarm.list", summary: "[无参]查闹钟",
    description: "打开系统闹钟/闹铃列表页。",
    examples: ["alarm.list"],
    keywords: ["闹钟列表"],
  }, []),
  command({
    toolId: "ask", name: "ask", summary: "询问用户 -> selected_option",
    description: "向用户提问并等待回答。有明确选项时传 --choices。",
    examples: ["ask \"打给哪一个？\" --choices 张三,李四","ask \"继续吗？\" --choices 是,否"],
    keywords: ["询问","确认"],
  }, [
      textPosition("question", "向用户提出的问题；包含空格时使用双引号。"),
      textFlag("choices", "逗号分隔的候选项。", false, "a,b,c")
    ]),
  command({
    toolId: "launch_app", name: "app.open", summary: "启动应用",
    description: "按包名启动应用。应用名解析请结合 app.list 与动态上下文中的已安装应用摘要。",
    examples: ["app.open com.tencent.mm","app.open com.jingdong.app.mall"],
    keywords: ["打开应用","启动应用"],
  }, [
      textPosition("package_name", "Android 应用包名。")
    ]),
  command({
    toolId: "open_android_uri", name: "uri.open", summary: "打开URI",
    description: "打开 deeplink 链接或通过系统浏览器打开 url 链接。",
    examples: ["uri.open https://www.example.com","uri.open https://www.baidu.com"],
    keywords: ["链接","网页"],
  }, [
      textPosition("uri", "要打开的 deeplink 或 URL。")
    ]),
  command({
    toolId: "scan", name: "qrcode.scan", summary: "扫一扫",
    description: "打开指定应用的扫一扫界面。",
    examples: ["qrcode.scan wechat","qrcode.scan alipay"],
    keywords: ["扫一扫","扫码"],
  }, [
      enumPosition("provider", "承载扫一扫的应用。", ["wechat","alipay","unionpay","meituan"], false)
    ]),
  command({
    toolId: "pay", name: "qrcode.pay", summary: "付款码",
    description: "打开付款码界面。",
    examples: ["qrcode.pay","qrcode.pay alipay"],
    keywords: ["付款码"],
  }, [
      enumPosition("provider", "承载付款码的应用。", ["wechat","alipay","unionpay"], false)
    ]),
  command({
    toolId: "ride", name: "qrcode.ride", summary: "乘车码",
    description: "打开乘车码界面。",
    examples: ["qrcode.ride alipay"],
    keywords: ["乘车码"],
  }, [
      enumPosition("provider", "承载乘车码的应用。", ["alipay","unionpay"], false)
    ]),
  command({
    toolId: "set_flashlight", name: "flash", summary: "手电筒",
    description: "打开或关闭手电筒。",
    examples: ["flash on","flash off"],
    keywords: ["手电筒"],
  }, [
      enumPosition("on", "on 打开手电筒，off 关闭手电筒。", ["on","off"])
    ]),
  command({
    toolId: "read_clipboard", name: "clip.read", summary: "[无参]读剪贴板",
    description: "读取剪贴板文本。",
    examples: ["clip.read"],
    keywords: ["剪贴板"],
  }, []),
  command({
    toolId: "write_clipboard", name: "clip.write", summary: "写剪贴板",
    description: "把文本写入剪贴板。",
    examples: ["clip.write \"明天下午三点开会\""],
    keywords: ["复制"],
  }, [
      textPosition("text", "写入剪贴板的文本；包含空格时使用双引号。")
    ]),
  command({
    toolId: "get_location", name: "location", summary: "[无参]查位置 -> lat/lon",
    description: "获取当前位置信息。",
    examples: ["location"],
    keywords: ["定位","在哪"],
  }, []),
  command({
    toolId: "get_weather", name: "weather", summary: "查天气 -> temp/humidity/condition",
    description: "查询天气；城市为空时使用定位城市。国内城市city为中文，国外城市city为英文。",
    examples: ["weather","weather 北京","weather 北京 --mode forecast"],
    keywords: ["天气","气温"],
  }, [
      textPosition("city", "城市名称；省略时使用定位城市。", false),
      enumFlag("mode", "天气查询模式。", ["live","forecast"]),
      textFlag("country_code", "ISO 3166-1 alpha-2 国家代码。", false, "ISO2")
    ]),
  command({
    toolId: "list_calendar_events", name: "calendar.list", summary: "查日程 -> events[]（含 event_id）",
    description: "列出日程。days_ahead 向未来查几天（今天=1）；省略时默认 7；before查过去N天内的日程",
    examples: ["calendar.list","calendar.list 14","calendar.list 14 --before 1"],
    keywords: ["日历","日程"],
  }, [
      textPosition("days_ahead", "向未来查询的天数，今天为 1；省略时默认 7。", false),
      textFlag("days_before", "向过去查询的天数。", false, "N", "before")
    ]),
  command({
    toolId: "calendar_create_or_update_event", name: "calendar.set", summary: "建/改日程",
    description: "创建或更新日程。date_expr 格式同 date 命令。",
    examples: ["calendar.set 团队会议 \"2026-06-13 14:00\"","calendar.set 周会 \"2026-06-13 09:00\" --duration 1.5"],
    keywords: ["会议","提醒"],
  }, [
      textPosition("title", "日程标题；包含空格时使用双引号。"),
      textPosition("date_expr", "日期时间表达式；包含空格时使用双引号。"),
      textFlag("duration_hours", "持续小时数。", false, "hours", "duration"),
      textFlag("location", "日程地点；包含空格时使用双引号。", false, "地点"),
      textFlag("event_id", "要更新的日程 ID。", false, "event_id", "id")
    ]),
  command({
    toolId: "calendar_delete_event", name: "calendar.delete", summary: "删日程",
    description: "按 event_id 删除日程。",
    examples: ["calendar.delete 610"],
    keywords: ["删除日程"],
  }, [
      textPosition("event_id", "要删除的日程 ID。")
    ]),
  command({
    toolId: "list_notifications", name: "notif.list", summary: "[无参]查通知 -> notifications[]",
    description: "列出当前活跃通知。",
    examples: ["notif.list","notif.list --limit 20"],
    keywords: ["通知"],
  }, [
      textFlag("limit", "最多返回的通知数。", false, "N")
    ]),
  command({
    toolId: "map_navigate", name: "map.navi", summary: "导航 -> places[]",
    description: "导航到目的地。多候选时返回 places[]，需 select 后再发起导航。",
    examples: ["map.navi 清华大学东门","map.navi 机场 --type transit"],
    keywords: ["导航","去"],
  }, [
      textPosition("dest", "导航目的地；包含空格时使用双引号。"),
      enumFlag("type", "出行方式。", ["driving","walking","riding","transit"])
    ]),
  command({
    toolId: "map_route_plan", name: "map.route", summary: "查路线 -> routes[]",
    description: "查看前往目的地的路线规划，可指定起点。",
    examples: ["map.route 清华大学东门 --type walking"],
    keywords: ["路线"],
  }, [
      textPosition("dest", "路线目的地；包含空格时使用双引号。"),
      textPosition("src", "路线起点；省略时使用当前位置。", false),
      enumFlag("type", "出行方式。", ["driving","walking","riding","transit"])
    ]),
  command({
    toolId: "map_nearby_search", name: "map.nearby", summary: "查附近 -> places[]",
    description: "根据类型或关键字查找附近的地点；查询后直接展示候选卡片，用户选序后只调用 `select`。POI 分类代码由具体 handler 转换，不暴露给模型。",
    examples: ["map.nearby 地铁 地铁站","map.nearby 购物 商场"],
    keywords: ["附近"],
  }, [
      enumPosition("poi_type", "附近地点类型。分类代码由具体 handler 转换。", ["购物","景点","地铁","公交","银行","停车","加油","充电"]),
      textPosition("keyword", "补充搜索关键词。", false)
    ]),
  command({
    toolId: "list_apps", name: "app.list", summary: "查应用 -> packageName[]",
    description: "搜索已安装应用，返回包名与标签。",
    examples: ["app.list","app.list 微信","app.list --limit 40"],
    keywords: ["应用列表"],
  }, [
      textPosition("query", "应用名称或包名关键词。", false, "keyword"),
      textFlag("limit", "最多返回的应用数。", false, "N")
    ]),
  command({
    toolId: "search_app_store", name: "appstore.search", summary: "应用商店搜索",
    description: "在应用商店搜索应用",
    examples: ["appstore.search 知乎"],
    keywords: ["下载"],
  }, [
      textPosition("keyword", "应用名称关键词。")
    ]),
  command({
    toolId: "set_timer", name: "timer", summary: "倒计时",
    description: "打开或设置计时器。",
    examples: ["timer","timer 300 --message 泡茶"],
    keywords: ["计时器"],
  }, [
      textPosition("seconds", "倒计时秒数；省略时打开计时器页面。", false),
      textFlag("message", "计时器标签；包含空格时使用双引号。", false, "label")
    ]),
  command({
    toolId: "set_hotspot_enabled", name: "hotspot", summary: "[无参]热点",
    description: "打开热点设置页面。",
    examples: ["hotspot"],
    keywords: ["热点"],
  }, []),
  command({
    toolId: "pick_ringtone", name: "ringtone", summary: "选铃声",
    description: "打开铃声选择器。",
    examples: ["ringtone","ringtone --type alarm"],
    keywords: ["铃声"],
  }, [
      enumFlag("type", "要选择的铃声类型。", ["ring","alarm","notification"])
    ]),
  command({
    toolId: "show_input_method_picker", name: "ime", summary: "[无参]切换输入法",
    description: "打开输入法选择器。",
    examples: ["ime"],
    keywords: ["输入法"],
  }, []),
  command({
    toolId: "open_settings_page", name: "sys.settings.open", summary: "打开设置",
    description: "打开系统设置子页面。",
    examples: ["sys.settings.open wifi","sys.settings.open bluetooth"],
    keywords: ["设置"],
  }, [
      textPosition("page", "系统设置页面名称，例如 wifi 或 bluetooth。")
    ]),
  command({
    toolId: "open_express_tracking", name: "express", summary: "查快递",
    description: "打开快递查询页面或检索快递单号。",
    examples: ["express","express SF1234567890"],
    keywords: ["快递"],
  }, [
      textPosition("tracking_no", "快递单号；省略时打开快递查询页。", false)
    ]),
  command({
    toolId: "explore_food", name: "food.explore", summary: "美食探索",
    description: "打开美食探索页面或搜索美食。",
    examples: ["food.explore","food.explore 火锅 --provider meituan"],
    keywords: ["美食"],
  }, [
      textPosition("keyword", "美食或餐厅关键词。", false),
      enumFlag("provider", "承载搜索的应用。", ["dianping","meituan"])
    ]),
  command({
    toolId: "search_shopping", name: "shopping.search", summary: "电商搜索",
    description: "电商搜索商品。",
    examples: ["shopping.search iphone --provider jd"],
    keywords: ["购物"],
  }, [
      textPosition("keyword", "商品关键词。"),
      enumFlag("provider", "承载搜索的电商应用。", ["taobao","jd","pdd"])
    ]),
  command({
    toolId: "join_meeting", name: "meeting.join", summary: "加入线上会议",
    description: "加入视频会议。",
    examples: ["meeting.join wemeet 927318171 --password 123456","meeting.join yunshixun 927318171"],
    keywords: ["会议"],
  }, [
      enumPosition("provider", "会议服务。", ["wemeet","yunshixun"]),
      textPosition("meeting_code", "会议号。"),
      textFlag("password", "会议密码。")
    ]),
  command({
    toolId: "query_flight", name: "flight.query", summary: "机票查询",
    description: "查询航班，可指定出发城市、到达城市、出发日期、返程日期、舱位、排序方式，支持往返查询，出发城市默认是定位城市。",
    examples: ["flight.query 广州","flight.query 上海 --when 06-15 --round --return 06-22"],
    keywords: ["机票"],
  }, [
      textPosition("arrive", "到达城市或机场。"),
      textFlag("depart", "出发城市或机场。", false, "出发"),
      textFlag("when", "出发日期表达式。", false, "date_expr"),
      switchFlag("round", "查询往返航班。"),
      textFlag("return_date", "返程日期表达式。", false, "date_expr", "return"),
      enumFlag("cabin", "舱位。", ["economy","premium_economy","business","first","business_first"]),
      enumFlag("sort", "排序方式。", ["earliest","latest","cheapest","priciest"])
    ]),
  command({
    toolId: "query_hotel", name: "hotel.query", summary: "酒店查询",
    description: "查询酒店，可指定入住城市、酒店品牌或名称、商圈或地标、入住日期、入住晚数、排序方式。",
    examples: ["hotel.query 上海","hotel.query 上海 --area 太古里 --when 明天"],
    keywords: ["酒店"],
  }, [
      textPosition("city", "入住城市。", false),
      textFlag("keyword", "酒店品牌或名称。", false, "品牌/店名"),
      textFlag("area", "商圈或地标。", false, "商圈/地标"),
      textFlag("when", "入住日期表达式。", false, "date_expr"),
      textFlag("nights", "入住晚数。", false, "N"),
      textFlag("brand", "酒店品牌。", false, "品牌"),
      enumFlag("sort", "排序方式。", ["price_asc","price_desc","distance","star_desc","score_desc"])
    ]),
  command({
    toolId: "query_train", name: "train.query", summary: "火车票查询",
    description: "查询火车票，可指定到达城市、出发城市、出发日期、是否高铁，出发城市默认是定位城市。",
    examples: ["train.query 上海虹桥","train.query 北京 --when 明天 --high_speed"],
    keywords: ["火车票"],
  }, [
      textPosition("arrive", "到达城市或车站。"),
      textFlag("depart", "出发城市或车站。", false, "出发"),
      textFlag("when", "出发日期表达式。", false, "date_expr"),
      switchFlag("high_speed", "仅查询高铁或动车。")
    ]),
  command({
    toolId: "query_scenic_ticket", name: "ticket.query", summary: "门票查询",
    description: "查询景点门票；keyword 可空表示门票首页。",
    examples: ["ticket.query 故宫","ticket.query"],
    keywords: ["门票"],
  }, [
      textPosition("keyword", "景点或门票关键词；省略时打开门票首页。", false)
    ]),
  command({
    toolId: "content_app_search", name: "content.search", summary: "App内搜索",
    description: "在指定 App 内打开搜索页",
    examples: ["content.search 北京美食 --provider xhs","content.search 周杰伦 --provider neteasemusic"],
    keywords: ["抖音","知乎","小红书","头条","微博","喜马拉雅","QQ音乐","网易云音乐","网易云","B站","哔哩哔哩","腾讯视频","爱奇艺","优酷"],
  }, [
      textPosition("keyword", "站内搜索关键词。"),
      enumFlag("provider", "要搜索的内容应用。", ["douyin","zhihu","xhs","toutiao","weibo","ximalaya","qqmusic","neteasemusic","bilibili","tencentvideo","iqiyi","youku"], true)
    ]),
  command({
    toolId: "take_system_screenshot", name: "screenshot", summary: "[无参]截屏",
    description: "截屏并保存到相册。",
    examples: ["screenshot"],
    keywords: ["截图"],
  }, []),
  command({
    toolId: "read_screen_content", name: "screen.read", summary: "读屏 -> text/qr",
    description: "读取当前屏幕可见文字；--detect_qr 尝试识码。",
    examples: ["screen.read","screen.read --detect_qr"],
    keywords: ["读屏"],
  }, [
      switchFlag("detect_qr", "同时尝试识别屏幕二维码。")
    ]),
]
