return {
  'mfussenegger/nvim-lint',
  event = { 'BufReadPre', 'BufNewFile' },
  config = function()
    local lint = require 'lint'
    lint.linters_by_ft = {
      fish = { 'fish' },
      go = { 'golangci-lint' },
      lua = { 'selene' },
      markdown = { 'vale' },
      python = { 'ruff' },
      javascript = {
        'eslint',
      },
      typescript = {
        'eslint',
      },
      javascriptreact = {
        'eslint',
      },
      typescriptreact = {
        'eslint',
      },
    }
    --Run linter on save or when leaving insert mode
    vim.api.nvim_create_autocmd({ 'InsertLeave', 'BufWritePost' }, {
      callback = function()
        local lint_status = pcall(require, 'lint')
        if lint_status then
          lint.try_lint()
        end
      end,
    })
  end,
}
