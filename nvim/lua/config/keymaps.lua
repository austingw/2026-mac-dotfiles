-- This file contains all the keymaps for my config
vim.opt.hlsearch = true
vim.keymap.set('n', '<Esc>', '<cmd>nohlsearch<CR>')

-- diagnostics
vim.keymap.set('n', '[d', vim.diagnostic.goto_prev, { desc = 'Go to previous [D]iagnostic message' })
vim.keymap.set('n', ']d', vim.diagnostic.goto_next, { desc = 'Go to next [D]iagnostic message' })
vim.keymap.set('n', '<leader>e', vim.diagnostic.open_float, { desc = 'Show diagnostic [E]rror messages' })
vim.keymap.set('n', '<leader>q', vim.diagnostic.setloclist, { desc = 'Open diagnostic [Q]uickfix list' })

-- easier window navigation
vim.keymap.set('n', '<C-h>', '<C-w><C-h>', { desc = 'Move focus to the left window' })
vim.keymap.set('n', '<C-l>', '<C-w><C-l>', { desc = 'Move focus to the right window' })
vim.keymap.set('n', '<C-j>', '<C-w><C-j>', { desc = 'Move focus to the lower window' })
vim.keymap.set('n', '<C-k>', '<C-w><C-k>', { desc = 'Move focus to the upper window' })

vim.keymap.set('n', '<leader>h', '<cmd>split<CR>', { desc = '[h]orizontally split window' })
vim.keymap.set('n', '<leader>v', '<cmd>vsplit<CR>', { desc = '[v]ertically split window' })

-- Move Lines
vim.keymap.set('n', '<C-Up>', '<cmd>m .-2<cr>==', { desc = 'Move up' })
vim.keymap.set('n', '<C-Down>', '<cmd>m .+1<cr>==', { desc = 'Move down' })
vim.keymap.set('i', '<C-Down>', '<esc><cmd>m .+1<cr>==gi', { desc = 'Move down' })
vim.keymap.set('i', '<C-Up>', '<esc><cmd>m .-2<cr>==gi', { desc = 'Move up' })
vim.keymap.set('v', '<C-Down>', ":m '>+1<cr>gv=gv", { desc = 'Move down' })
vim.keymap.set('v', '<C-Up>', ":m '<-2<cr>gv=gv", { desc = 'Move up' })

-- better up/down movement
vim.keymap.set('n', '<C-u>', '<C-u>zz', { desc = 'Move half page up with cursor in the middle' })
vim.keymap.set('n', '<C-d>', '<C-d>zz', { desc = 'Move half page down with cursor in the middle' })

-- plugin
vim.keymap.set('n', '<leader>g', '<cmd>Neogit<CR>', { desc = 'Open Neo[g]it' })
vim.keymap.set('n', '<leader>t', '<cmd>Neotree toggle<CR>', { desc = 'Open Neo[t]ree' })
