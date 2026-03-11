return {
  { --My favorite color scheme, has variants like 'terafox', 'nordfox', and 'carbonfox' that I may switch between
    'EdenEast/nightfox.nvim',
    config = function()
      -- Default options
      require('nightfox').setup {
        options = {
          transparent = true, -- Disable setting background
        },
      }
    end,
    init = function()
      vim.cmd.colorscheme 'nightfox'
    end,
  },
}
