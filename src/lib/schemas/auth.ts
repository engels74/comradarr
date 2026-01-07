import * as v from 'valibot';

export const LoginSchema = v.object({
	username: v.pipe(
		v.string('Username is required'),
		v.trim(),
		v.minLength(1, 'Username is required'),
		v.maxLength(100, 'Username must be 100 characters or less')
	),
	password: v.pipe(v.string('Password is required'), v.minLength(1, 'Password is required'))
});

export type LoginInput = v.InferInput<typeof LoginSchema>;
export type LoginOutput = v.InferOutput<typeof LoginSchema>;
