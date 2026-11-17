
/Volumes/Lexar/Project/医院仿真/reverse/experiment/raw/UnityPlayer.dll:	file format coff-x86-64

Disassembly of section .text:

0000000180001000 <.text>:
1804a260d: 48 8b 05 7c b6 56 01        	movq	0x156b67c(%rip), %rax   # 0x181a0dc90
1804a2614: c7 45 bb 01 00 00 00        	movl	$0x1, -0x45(%rbp)
1804a261b: 44 88 75 af                 	movb	%r14b, -0x51(%rbp)
1804a261f: c6 45 b7 01                 	movb	$0x1, -0x49(%rbp)
1804a2623: 48 ff c6                    	incq	%rsi
1804a2626: 80 3c 30 00                 	cmpb	$0x0, (%rax,%rsi)
1804a262a: 75 f7                       	jne	0x1804a2623 <.text+0x4a1623>
1804a262c: 80 7b 20 01                 	cmpb	$0x1, 0x20(%rbx)
1804a2630: 48 89 45 87                 	movq	%rax, -0x79(%rbp)
1804a2634: 48 89 75 8f                 	movq	%rsi, -0x71(%rbp)
1804a2638: 75 0d                       	jne	0x1804a2647 <.text+0x4a1647>
1804a263a: 48 0f be 43 18              	movsbq	0x18(%rbx), %rax
1804a263f: 49 8b ce                    	movq	%r14, %rcx
1804a2642: 48 2b c8                    	subq	%rax, %rcx
1804a2645: eb 07                       	jmp	0x1804a264e <.text+0x4a164e>
1804a2647: 48 8b 4b 10                 	movq	0x10(%rbx), %rcx
1804a264b: 48 8b 1b                    	movq	(%rbx), %rbx
1804a264e: 48 89 4c 24 28              	movq	%rcx, 0x28(%rsp)
1804a2653: 4c 8d 4d 97                 	leaq	-0x69(%rbp), %r9
1804a2657: 48 8d 4c 24 20              	leaq	0x20(%rsp), %rcx
1804a265c: 48 89 5c 24 20              	movq	%rbx, 0x20(%rsp)
1804a2661: 41 b0 2f                    	movb	$0x2f, %r8b
1804a2664: 48 8d 55 87                 	leaq	-0x79(%rbp), %rdx
1804a2668: e8 b3 33 0a 00              	callq	0x180545a20 <.text+0x544a20>
1804a266d: 80 7d b7 01                 	cmpb	$0x1, -0x49(%rbp)
1804a2671: 75 0e                       	jne	0x1804a2681 <.text+0x4a1681>
1804a2673: 48 0f be 45 af              	movsbq	-0x51(%rbp), %rax
1804a2678: 4c 2b f0                    	subq	%rax, %r14
1804a267b: 48 8d 45 97                 	leaq	-0x69(%rbp), %rax
1804a267f: eb 08                       	jmp	0x1804a2689 <.text+0x4a1689>
1804a2681: 4c 8b 75 a7                 	movq	-0x59(%rbp), %r14
1804a2685: 48 8b 45 97                 	movq	-0x69(%rbp), %rax
1804a2689: 48 8d 4d 2f                 	leaq	0x2f(%rbp), %rcx
1804a268d: 48 89 45 2f                 	movq	%rax, 0x2f(%rbp)
1804a2691: 4c 89 75 37                 	movq	%r14, 0x37(%rbp)
1804a2695: bf 07 00 00 00              	movl	$0x7, %edi
1804a269a: e8 61 d8 09 00              	callq	0x18053ff00 <.text+0x53ef00>
1804a269f: 84 c0                       	testb	%al, %al

/Volumes/Lexar/Project/医院仿真/reverse/experiment/raw/UnityPlayer.dll:	file format coff-x86-64

Disassembly of section .text:

0000000180001000 <.text>:
1804a2fba: 48 8b 15 cf ac 56 01        	movq	0x156accf(%rip), %rdx   # 0x181a0dc90
1804a2fc1: 48 c7 c7 ff ff ff ff        	movq	$-0x1, %rdi
1804a2fc8: 48 8b cf                    	movq	%rdi, %rcx
1804a2fcb: c7 45 fb 01 00 00 00        	movl	$0x1, -0x5(%rbp)
1804a2fd2: 4c 8b f0                    	movq	%rax, %r14
1804a2fd5: c6 45 d7 00                 	movb	$0x0, -0x29(%rbp)
1804a2fd9: 40 88 75 ef                 	movb	%sil, -0x11(%rbp)
1804a2fdd: c6 45 f7 01                 	movb	$0x1, -0x9(%rbp)
1804a2fe1: 48 ff c1                    	incq	%rcx
1804a2fe4: 80 3c 0a 00                 	cmpb	$0x0, (%rdx,%rcx)
1804a2fe8: 75 f7                       	jne	0x1804a2fe1 <.text+0x4a1fe1>
1804a2fea: 80 7b 20 01                 	cmpb	$0x1, 0x20(%rbx)
1804a2fee: 48 89 55 ff                 	movq	%rdx, -0x1(%rbp)
1804a2ff2: 48 89 4d 07                 	movq	%rcx, 0x7(%rbp)
1804a2ff6: 75 10                       	jne	0x1804a3008 <.text+0x4a2008>
1804a2ff8: 48 0f be 43 18              	movsbq	0x18(%rbx), %rax
1804a2ffd: 48 8b ce                    	movq	%rsi, %rcx
1804a3000: 48 2b c8                    	subq	%rax, %rcx
1804a3003: 48 8b c3                    	movq	%rbx, %rax
1804a3006: eb 07                       	jmp	0x1804a300f <.text+0x4a200f>
1804a3008: 48 8b 4b 10                 	movq	0x10(%rbx), %rcx
1804a300c: 48 8b 03                    	movq	(%rbx), %rax
1804a300f: 48 89 4d 17                 	movq	%rcx, 0x17(%rbp)
1804a3013: 4c 8d 4d d7                 	leaq	-0x29(%rbp), %r9
1804a3017: 48 8d 4d 0f                 	leaq	0xf(%rbp), %rcx
1804a301b: 48 89 45 0f                 	movq	%rax, 0xf(%rbp)
1804a301f: 41 b0 2f                    	movb	$0x2f, %r8b
1804a3022: 48 8d 55 ff                 	leaq	-0x1(%rbp), %rdx
1804a3026: e8 f5 29 0a 00              	callq	0x180545a20 <.text+0x544a20>
1804a302b: 4c 8d 45 d7                 	leaq	-0x29(%rbp), %r8
1804a302f: 48 8b d3                    	movq	%rbx, %rdx
1804a3032: 49 8b ce                    	movq	%r14, %rcx
1804a3035: e8 36 a4 0a 00              	callq	0x18054d470 <.text+0x54c470>
1804a303a: 80 7d f7 00                 	cmpb	$0x0, -0x9(%rbp)
1804a303e: 75 19                       	jne	0x1804a3059 <.text+0x4a2059>
1804a3040: 8b 55 fb                    	movl	-0x5(%rbp), %edx
1804a3043: 4c 8d 05 92 c4 1a 01        	leaq	0x11ac492(%rip), %r8    # 0x18164f4dc
1804a304a: 48 8b 4d d7                 	movq	-0x29(%rbp), %rcx
1804a304e: 41 b9 0d 02 00 00           	movl	$0x20d, %r9d            # imm = 0x20D

/Volumes/Lexar/Project/医院仿真/reverse/experiment/raw/UnityPlayer.dll:	file format coff-x86-64

Disassembly of section .text:

0000000180001000 <.text>:
18054d660: 8b ce                       	movl	%esi, %ecx
18054d662: e8 19 13 00 00              	callq	0x18054e980 <.text+0x54d980>
18054d667: 49 89 36                    	movq	%rsi, (%r14)
18054d66a: 48 8b cb                    	movq	%rbx, %rcx
18054d66d: e8 3e 88 d2 ff              	callq	0x180275eb0 <.text+0x274eb0>
18054d672: 80 7f 20 01                 	cmpb	$0x1, 0x20(%rdi)
18054d676: 48 8b d7                    	movq	%rdi, %rdx
18054d679: 74 03                       	je	0x18054d67e <.text+0x54c67e>
18054d67b: 48 8b 17                    	movq	(%rdi), %rdx
18054d67e: 49 8b 4e 10                 	movq	0x10(%r14), %rcx
18054d682: 45 33 c0                    	xorl	%r8d, %r8d
18054d685: e8 46 93 00 00              	callq	0x1805569d0 <.text+0x5559d0>
18054d68a: 84 c0                       	testb	%al, %al
18054d68c: 75 66                       	jne	0x18054d6f4 <.text+0x54c6f4>
18054d68e: 80 7f 20 01                 	cmpb	$0x1, 0x20(%rdi)
18054d692: 74 03                       	je	0x18054d697 <.text+0x54c697>
18054d694: 48 8b 3f                    	movq	(%rdi), %rdi
18054d697: 48 8b d7                    	movq	%rdi, %rdx
18054d69a: 48 8d 0d 2f 7e 1a 01        	leaq	0x11a7e2f(%rip), %rcx   # 0x1816f54d0
18054d6a1: e8 9a 86 86 00              	callq	0x180db5d40 <UnityMain+0x725410>
18054d6a6: 48 8b 8c 24 50 04 00 00     	movq	0x450(%rsp), %rcx
18054d6ae: 32 db                       	xorb	%bl, %bl
18054d6b0: 4c 8b b4 24 80 04 00 00     	movq	0x480(%rsp), %r14
18054d6b8: 48 8b bc 24 a8 04 00 00     	movq	0x4a8(%rsp), %rdi

/Volumes/Lexar/Project/医院仿真/reverse/experiment/raw/UnityPlayer.dll:	file format coff-x86-64

Disassembly of section .text:

0000000180001000 <.text>:
1805501b0: f6 cf                       	<unknown>
1805501b2: ff 48 8d                    	decl	-0x73(%rax)
1805501b5: 94                          	xchgl	%esp, %eax
1805501b6: 24 b8                       	andb	$-0x48, %al
1805501b8: 00 00                       	addb	%al, (%rax)
1805501ba: 00 48 8b                    	addb	%cl, -0x75(%rax)
1805501bd: cf                          	iretl
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
180550240: 80 7b 20 01                 	cmpb	$0x1, 0x20(%rbx)
180550244: 75 14                       	jne	0x18055025a <.text+0x54f25a>
180550246: 48 0f be 43 18              	movsbq	0x18(%rbx), %rax
18055024b: be 18 00 00 00              	movl	$0x18, %esi
