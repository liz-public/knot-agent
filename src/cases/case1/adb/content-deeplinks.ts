/** CASE1 catalog provider ids for `content.search`. */
export type ContentSearchProvider =
  | 'douyin'
  | 'zhihu'
  | 'xhs'
  | 'toutiao'
  | 'weibo'
  | 'ximalaya'
  | 'qqmusic'
  | 'neteasemusic'
  | 'bilibili'
  | 'tencentvideo'
  | 'iqiyi'
  | 'youku'

interface ContentSearchTarget {
  readonly packageName: string
  readonly buildUri: (keyword: string) => string
}

const enc = encodeURIComponent

const TARGETS: Record<ContentSearchProvider, ContentSearchTarget> = {
  douyin: {
    packageName: 'com.ss.android.ugc.aweme',
    buildUri: keyword => `snssdk1128://search?keyword=${enc(keyword)}&refer=web`,
  },
  zhihu: {
    packageName: 'com.zhihu.android',
    buildUri: keyword => `zhihu://search?q=${enc(keyword)}`,
  },
  xhs: {
    packageName: 'com.xingin.xhs',
    buildUri: keyword => `xhsdiscover://search/result?keyword=${enc(keyword)}&target_search=notes`,
  },
  toutiao: {
    packageName: 'com.ss.android.article.news',
    buildUri: keyword => `snssdk141://search?keyword=${enc(keyword)}`,
  },
  weibo: {
    packageName: 'com.sina.weibo',
    buildUri: keyword => `sinaweibo://searchall?q=${enc(keyword)}`,
  },
  ximalaya: {
    packageName: 'com.ximalaya.ting.android',
    buildUri: keyword => `iting://open?msg_type=32&keyword=${enc(keyword)}`,
  },
  // Unverified on device — SDK old worktree uses `key=`, not `search_key=`.
  qqmusic: {
    packageName: 'com.tencent.qqmusic',
    buildUri: keyword => `qqmusic://qq.com/ui/search?search_key=${enc(keyword)}`,
  },
  neteasemusic: {
    packageName: 'com.netease.cloudmusic',
    buildUri: keyword => `orpheus://nm/search/result?keyword=${enc(keyword)}`,
  },
  bilibili: {
    packageName: 'tv.danmaku.bili',
    buildUri: keyword => `bilibili://search?keyword=${enc(keyword)}`,
  },
  tencentvideo: {
    packageName: 'com.tencent.qqlive',
    buildUri: keyword => `txvideo://v.qq.com/SearchPagerActivity?searchKey=${enc(keyword)}`,
  },
  iqiyi: {
    packageName: 'com.qiyi.video',
    buildUri: keyword => `iqiyi://mobile/search?keyword=${enc(keyword)}`,
  },
  youku: {
    packageName: 'com.youku.phone',
    buildUri: keyword => `youku://soku/searchresult?keyword=${enc(keyword)}`,
  },
}

export function isContentSearchProvider(value: string): value is ContentSearchProvider {
  return value in TARGETS
}

export function contentSearchTarget(provider: ContentSearchProvider): ContentSearchTarget {
  return TARGETS[provider]
}
