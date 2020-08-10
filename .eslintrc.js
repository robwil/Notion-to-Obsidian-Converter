module.exports = {
	root: true,
	env: {
		node: true,
	},
	extends: [],
	parserOptions: {
		parser: 'babel-eslint',
	},
	rules: {
		'no-console': process.env.NODE_ENV === 'production' ? 'warn' : 'off',
		'no-debugger': process.env.NODE_ENV === 'production' ? 'warn' : 'off',
		'max-len': [
			'off',
			{
				code: 100,
				ignoreComments: true,
				ignoreTemplateLiterals: true,
				ignoreTrailingComments: true,
				ignoreUrls: true,
			},
		],
		quotes: ['error', 'single'],
		'no-tabs': ['off', { allowIndentationTabs: true }],
		indent: ['error', 'tab', { SwitchCase: 1 }],
		'brace-style': ['error', '1tbs', { allowSingleLine: true }],
		'no-param-reassign': ['warn'],
		'comma-dangle': ['error', 'only-multiline'],
		'no-underscore-dangle': ['error', { allowAfterThis: true, allowAfterSuper: true }],
		'arrow-parens': ['error', 'as-needed'],
		'import/extensions': ['off'],
		'func-names': ['off', 'as-needed'],
		'space-before-function-paren': ['error', 'never'],
		'operator-linebreak': ['off'],
	},
};
