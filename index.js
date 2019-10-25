const fs = require('fs')
const path = require('path')
const puppeteer = require('puppeteer')
const cheerio = require('cheerio')
// const qs = require('qs')

const ENTRY = 'https://mp.weixin.qq.com'

const userDataDir = path.join(__dirname, 'puppeteer', 'chrome-user-data')

let ADMIN_OPENID = ''

const inBrowserJs = {}
;(function (js, $) {
  // js.getMessages = function () {
  //   return eval(Array.from($('script'))
  //     .find(s => s.text.indexOf('wx.cgiData =') > 0)
  //     .text.split(/[\r\n]+/)
  //     .find(l => l.trim().indexOf('list') === 0)
  //     .trim()
  //     .slice(7, -1))
  // }
  js.doAjax = function (options) {
    return new Promise((resolve, reject) => {
      console.log('doAjax >>', options)
      window.$.ajax({
        ...options,
        success (data) {
          console.log('ajax ok>>', data)
          resolve(data)
        },
        error (xhr, status, error) {
          console.log('ajax error>>', error || status)
          reject(error || status)
        }
      })
    })
  }
})(inBrowserJs)

async function main () {
  if (!process.argv[2]) throw new Error('必须将管理者fakeid作为参数传入，请到公众号后台用户管理的列表中，从管理员的链接中截取')
  ADMIN_OPENID = process.argv[2]
  // const headless = process.argv[2] === '--headless'
  const excludes = ['--enable-automation', '--headless']
  // if (!headless) excludes.push('--headless')
  fs.mkdirSync(userDataDir, { recursive: true })
  const args = puppeteer.defaultArgs()
    .filter(a => excludes.indexOf(a) < 0)
    .concat(['--start-maximized', '--user-data-dir=' + userDataDir])
  const browser = await puppeteer.launch({
    // headless: false,
    ignoreDefaultArgs: true,
    args,
    defaultViewport: null
  })
  const page = await browser.newPage()
  const token = await new Promise(resolve => {
    page.on('load', async () => {
      const url = new URL(await page.evaluate('location.href'))
      console.log(new Date(), 'LOAD: ' + url)
      const t = url.searchParams.get('t')
      if (t !== 'home/index') return
      resolve(url.searchParams.get('token'))
    })
    page.goto(ENTRY)
  })
  let recentMsgTime = 0
  let recentOpenId
  const recentUsers = [{ openId: ADMIN_OPENID, name: 'ADMIN' }]
  const options = { url: `https://mp.weixin.qq.com/cgi-bin/message?t=message/list&count=20&day=7&token=${token}&lang=zh_CN`, dataType: 'text' }
  try {
    const txt = fs.readFileSync(path.join(__dirname, 'recentMsgTime.txt'), 'utf8')
    if (/^\d+$/.test(txt)) recentMsgTime = ~~txt
  } catch (e) { }
  while (1) {
    const rawHtml = await page.evaluate(inBrowserJs.doAjax, options)
    const $ = cheerio.load(rawHtml)
    const msgList = eval(Array.from($('script'))
      .map(n => $(n))
      .find(n => n.html().indexOf('wx.cgiData =') > 0)
      .html().split(/[\r\n]+/)
      .find(l => l.trim().indexOf('list') === 0)
      .trim()
      .slice(7, -1))
      .filter(o => o.type === 1 && o.date_time > recentMsgTime)
    if (msgList.length > 0) {
      console.log(msgList.map(o => `${o.nick_name}: ${o.content}`))
      recentMsgTime = msgList[0].date_time
      fs.writeFileSync(path.join(__dirname, 'recentMsgTime.txt'), recentMsgTime, 'utf8')
      const jobs = msgList.reverse().map(o => {
        let linkId
        if ((linkId = recentUsers.map(u => u.openId).indexOf(o.fakeid)) < 0) {
          linkId = recentUsers.length
          recentUsers.push({ openId: o.fakeid, name: o.nick_name })
        }
        const options = {
          url: `https://mp.weixin.qq.com/cgi-bin/singlesend?t=ajax-response&f=json&token=${token}&lang=zh_CN`,
          dataType: 'json',
          type: 'POST',
          data: {
            token,
            lang: 'zh_CN',
            f: 'json',
            ajax: 1,
            random: Math.random(),
            type: 1,
            imgcode: ''
          }
        }
        let tofakeid
        let content = o.content
        if (linkId === 0) { // from admin
          const mch = /^(\d+) /.exec(o.content)
          if (mch) {
            if (~~mch[1] < recentUsers.length) {
              tofakeid = recentUsers[mch[1]].openId
              content = o.content.substring(mch[0].length).trim()
            } else {
              tofakeid = ADMIN_OPENID
              content = `不存在对话ID为${mch[1]}的用户！`
            }
          } else {
            tofakeid = recentOpenId
          }
        } else {
          recentOpenId = o.fakeid
          tofakeid = ADMIN_OPENID
          content = `[${linkId}] ${o.nick_name} 说: ${o.content}`
        }
        Object.assign(options.data, { content, tofakeid })
        return page.evaluate(inBrowserJs.doAjax, options)
      })
      await Promise.all(jobs)
      await new Promise(resolve => setTimeout(resolve, 4000))
    }
  }
  // await browser.close()
}

main()
