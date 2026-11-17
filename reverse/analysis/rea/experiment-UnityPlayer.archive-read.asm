
/Volumes/Lexar/Project/医院仿真/reverse/experiment/raw/UnityPlayer.dll:	file format coff-x86-64

Disassembly of section .text:

0000000180001000 <.text>:
1805501be: e8 1d e7 ff ff              	callq	0x18054e8e0 <.text+0x54d8e0>
1805501c3: 45 33 e4                    	xorl	%r12d, %r12d
1805501c6: 45 32 ed                    	xorb	%r13b, %r13b
1805501c9: 48 8b 30                    	movq	(%rax), %rsi
1805501cc: 48 89 b4 24 c0 00 00 00     	movq	%rsi, 0xc0(%rsp)
1805501d4: 4c 8d 8c 24 b8 00 00 00     	leaq	0xb8(%rsp), %r9
1805501dc: 48 c7 84 24 b8 00 00 00 00 00 00 00 	movq	$0x0, 0xb8(%rsp)
1805501e8: 4c 8d 44 24 30              	leaq	0x30(%rsp), %r8
1805501ed: c7 44 24 20 00 00 00 00     	movl	$0x0, 0x20(%rsp)
1805501f5: ba 40 00 00 00              	movl	$0x40, %edx
1805501fa: 48 8b cf                    	movq	%rdi, %rcx
1805501fd: e8 3e e8 ff ff              	callq	0x18054ea40 <.text+0x54da40>
180550202: 84 c0                       	testb	%al, %al
180550204: 0f 84 d5 00 00 00           	je	0x1805502df <.text+0x54f2df>
18055020a: 48 8b 84 24 b8 00 00 00     	movq	0xb8(%rsp), %rax
180550212: 48 85 c0                    	testq	%rax, %rax
180550215: 0f 84 c4 00 00 00           	je	0x1805502df <.text+0x54f2df>
18055021b: 45 33 ff                    	xorl	%r15d, %r15d
18055021e: 48 85 c0                    	testq	%rax, %rax
180550221: 0f 84 ab 00 00 00           	je	0x1805502d2 <.text+0x54f2d2>
180550227: 4c 8d 74 24 30              	leaq	0x30(%rsp), %r14
18055022c: 0f 1f 40 00                 	nopl	(%rax)
180550230: 41 0f b6 2e                 	movzbl	(%r14), %ebp
180550234: 41 ff c4                    	incl	%r12d
180550237: 40 84 ed                    	testb	%bpl, %bpl
18055023a: 0f 84 87 00 00 00           	je	0x1805502c7 <.text+0x54f2c7>

/Volumes/Lexar/Project/医院仿真/reverse/experiment/raw/UnityPlayer.dll:	file format coff-x86-64

Disassembly of section .text:

0000000180001000 <.text>:
18054ea40: 48 83 ec 38                 	subq	$0x38, %rsp
18054ea44: 4c 8b da                    	movq	%rdx, %r11
18054ea47: 48 8b d1                    	movq	%rcx, %rdx
18054ea4a: 48 8b 89 20 04 00 00        	movq	0x420(%rcx), %rcx
18054ea51: 48 85 c9                    	testq	%rcx, %rcx
18054ea54: 74 26                       	je	0x18054ea7c <.text+0x54da7c>
18054ea56: 48 8b 01                    	movq	(%rcx), %rax
18054ea59: 48 83 c2 08                 	addq	$0x8, %rdx
18054ea5d: 4c 8b 50 10                 	movq	0x10(%rax), %r10
18054ea61: 8b 44 24 60                 	movl	0x60(%rsp), %eax
18054ea65: 89 44 24 28                 	movl	%eax, 0x28(%rsp)
18054ea69: 4c 89 4c 24 20              	movq	%r9, 0x20(%rsp)
18054ea6e: 4d 8b c8                    	movq	%r8, %r9
18054ea71: 4d 8b c3                    	movq	%r11, %r8
18054ea74: 41 ff d2                    	callq	*%r10
18054ea77: 48 83 c4 38                 	addq	$0x38, %rsp
18054ea7b: c3                          	retq
18054ea7c: 32 c0                       	xorb	%al, %al
18054ea7e: 48 83 c4 38                 	addq	$0x38, %rsp
18054ea82: c3                          	retq
18054ea83: cc                          	int3
18054ea84: cc                          	int3
18054ea85: cc                          	int3
18054ea86: cc                          	int3
18054ea87: cc                          	int3
18054ea88: cc                          	int3
18054ea89: cc                          	int3
18054ea8a: cc                          	int3
18054ea8b: cc                          	int3
18054ea8c: cc                          	int3
18054ea8d: cc                          	int3
18054ea8e: cc                          	int3
18054ea8f: cc                          	int3
18054ea90: 48 83 ec 38                 	subq	$0x38, %rsp
18054ea94: 48 8b 8a 28 04 00 00        	movq	0x428(%rdx), %rcx
18054ea9b: 4d 8b d9                    	movq	%r9, %r11
18054ea9e: 4c 8b 4c 24 60              	movq	0x60(%rsp), %r9
