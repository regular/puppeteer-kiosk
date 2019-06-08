module.exports = function() {
  return function makeTrigger(name, args) {
    const words = args.split(' ')
    if (name == 'console') {  // level regex
      const [level, ...re] = words
      const regex = new RegExp(re.join(' '))
      return function(args) {
        //console.log('TESTING console', args)
        const words = args.split(' ')
        const [level2, ...text] = words
        //console.log('level', level, 'level2', level2, regex, text)
        if (level2 !== level) return false
        return regex.test(text.join(' '))
      }
    }
    return null
  }
}
