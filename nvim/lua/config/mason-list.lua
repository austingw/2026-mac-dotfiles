-- Mason-installable formatters and linters.
-- LSP servers are handled separately via the `servers` table in plugins/lsp.lua.
-- Tools that are not Mason packages (e.g. fish_indent, fish) are excluded.
return {
  -- Formatters
  'gofumpt',
  'google-java-format',
  'prettier',
  'prettierd',
  'stylua',

  -- Linters
  'eslint',
  'golangci-lint',
  'selene',
  'vale',
}
