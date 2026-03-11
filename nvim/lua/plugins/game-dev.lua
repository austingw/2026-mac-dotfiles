return {
  {
    'S1M0N38/love2d.nvim',
    event = 'VeryLazy',
    version = '2.*',
    opts = {
      path_to_love_bin = '/Applications/love.app/Contents/MacOS/love',
      restart_on_save = false,
      debug_window_opts = nil,
      setup_makeprg = true,
      identify_love_projects = true,
    },
    keys = {
      { '<leader>l', ft = 'lua', desc = 'LÖVE' },
      { '<leader>lr', '<cmd>LoveRun<cr>', ft = 'lua', desc = 'Run LÖVE' },
      { '<leader>ls', '<cmd>LoveStop<cr>', ft = 'lua', desc = 'Stop LÖVE' },
    },
  },
}
