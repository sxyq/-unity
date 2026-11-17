
/Volumes/Lexar/Project/医院仿真/reverse/experiment/raw/UnityPlayer.dll:	file format coff-x86-64

Disassembly of section .text:

0000000180690930 <UnityMain>:
180b74f00: 48 8b c4                    	movq	%rsp, %rax
180b74f03: 55                          	pushq	%rbp
180b74f04: 48 8d a8 a8 fe ff ff        	leaq	-0x158(%rax), %rbp
180b74f0b: 48 81 ec 50 02 00 00        	subq	$0x250, %rsp            # imm = 0x250
180b74f12: 66 0f 6f 05 26 73 b0 00     	movdqa	0xb07326(%rip), %xmm0   # 0x18167c240
180b74f1a: 48 8d 0d ef 5c c2 00        	leaq	0xc25cef(%rip), %rcx    # 0x18179ac10
180b74f21: 48 89 58 08                 	movq	%rbx, 0x8(%rax)
180b74f25: 48 89 78 18                 	movq	%rdi, 0x18(%rax)
180b74f29: 4c 89 68 e8                 	movq	%r13, -0x18(%rax)
180b74f2d: 45 33 ed                    	xorl	%r13d, %r13d
180b74f30: 4c 89 6c 24 78              	movq	%r13, 0x78(%rsp)
180b74f35: 41 8b c5                    	movl	%r13d, %eax
180b74f38: 44 88 6c 24 50              	movb	%r13b, 0x50(%rsp)
180b74f3d: c7 45 80 4b 00 00 00        	movl	$0x4b, -0x80(%rbp)
180b74f44: f3 0f 7f 45 88              	movdqu	%xmm0, -0x78(%rbp)
180b74f49: c7 44 24 74 01 00 00 00     	movl	$0x1, 0x74(%rsp)
180b74f51: c6 44 24 68 18              	movb	$0x18, 0x68(%rsp)
180b74f56: c6 44 24 70 01              	movb	$0x1, 0x70(%rsp)
180b74f5b: 0f 1f 44 00 00              	nopl	(%rax,%rax)
180b74f60: 44 38 2c 08                 	cmpb	%r13b, (%rax,%rcx)
180b74f64: 74 0e                       	je	0x180b74f74 <UnityMain+0x4e4644>
180b74f66: 48 ff c0                    	incq	%rax
180b74f69: 48 83 f8 1e                 	cmpq	$0x1e, %rax
180b74f6d: 72 f1                       	jb	0x180b74f60 <UnityMain+0x4e4630>
180b74f6f: b8 1e 00 00 00              	movl	$0x1e, %eax
180b74f74: 48 89 4c 24 40              	movq	%rcx, 0x40(%rsp)
180b74f79: 48 8d 54 24 40              	leaq	0x40(%rsp), %rdx
180b74f7e: 48 8d 4c 24 50              	leaq	0x50(%rsp), %rcx
180b74f83: 48 89 44 24 48              	movq	%rax, 0x48(%rsp)
180b74f88: e8 23 ba 9c ff              	callq	0x1805409b0 <.text+0x53f9b0>
180b74f8d: bf 00 00 00 80              	movl	$0x80000000, %edi       # imm = 0x80000000
180b74f92: 48 c7 c3 ff ff ff ff        	movq	$-0x1, %rbx
180b74f99: 84 c0                       	testb	%al, %al
180b74f9b: 0f 84 91 01 00 00           	je	0x180b75132 <UnityMain+0x4e4802>
180b74fa1: 80 7c 24 70 01              	cmpb	$0x1, 0x70(%rsp)
180b74fa6: 48 8d 54 24 50              	leaq	0x50(%rsp), %rdx
180b74fab: 44 89 6c 24 30              	movl	%r13d, 0x30(%rsp)
180b74fb0: 44 8d 4b 02                 	leal	0x2(%rbx), %r9d
180b74fb4: 48 0f 45 54 24 50           	cmovneq	0x50(%rsp), %rdx
180b74fba: 48 8d 4d e0                 	leaq	-0x20(%rbp), %rcx
180b74fbe: 4c 89 6c 24 28              	movq	%r13, 0x28(%rsp)
180b74fc3: 44 8b c7                    	movl	%edi, %r8d
180b74fc6: 4c 89 bc 24 30 02 00 00     	movq	%r15, 0x230(%rsp)
180b74fce: 44 88 6c 24 20              	movb	%r13b, 0x20(%rsp)
180b74fd3: e8 58 dc de ff              	callq	0x180962c30 <UnityMain+0x2d2300>
180b74fd8: 4c 8b 7d 48                 	movq	0x48(%rbp), %r15
180b74fdc: 44 88 6d 40                 	movb	%r13b, 0x40(%rbp)
180b74fe0: 4d 85 ff                    	testq	%r15, %r15
180b74fe3: 0f 84 2c 01 00 00           	je	0x180b75115 <UnityMain+0x4e47e5>
180b74fe9: 41 83 7f 10 03              	cmpl	$0x3, 0x10(%r15)
180b74fee: 0f 85 21 01 00 00           	jne	0x180b75115 <UnityMain+0x4e47e5>
180b74ff4: 48 8b 55 10                 	movq	0x10(%rbp), %rdx
180b74ff8: 4c 8d 0d 71 72 c1 00        	leaq	0xc17271(%rip), %r9     # 0x18178c270
180b74fff: 4d 8b c7                    	movq	%r15, %r8
180b75002: 4c 89 a4 24 48 02 00 00     	movq	%r12, 0x248(%rsp)
180b7500a: 48 8d 4d e0                 	leaq	-0x20(%rbp), %rcx
180b7500e: e8 fd e9 de ff              	callq	0x180963a10 <UnityMain+0x2d30e0>
180b75013: 48 8b 0d 8e e0 b5 00        	movq	0xb5e08e(%rip), %rcx    # 0x1816d30a8
180b7501a: 4c 8b 65 10                 	movq	0x10(%rbp), %r12
180b7501e: 48 89 4d 10                 	movq	%rcx, 0x10(%rbp)
180b75022: 48 89 45 48                 	movq	%rax, 0x48(%rbp)
180b75026: 48 85 c0                    	testq	%rax, %rax
180b75029: 0f 84 d6 00 00 00           	je	0x180b75105 <UnityMain+0x4e47d5>
180b7502f: 48 8b 45 60                 	movq	0x60(%rbp), %rax
180b75033: 48 8b 4d 50                 	movq	0x50(%rbp), %rcx
180b75037: 48 89 b4 24 68 02 00 00     	movq	%rsi, 0x268(%rsp)
180b7503f: 48 8d 78 01                 	leaq	0x1(%rax), %rdi
180b75043: 8b 74 c1 fc                 	movl	-0x4(%rcx,%rax,8), %esi
180b75047: 48 8b 45 68                 	movq	0x68(%rbp), %rax
180b7504b: 48 d1 e8                    	shrq	%rax
180b7504e: 48 3b f8                    	cmpq	%rax, %rdi
180b75051: 76 0d                       	jbe	0x180b75060 <UnityMain+0x4e4730>
180b75053: 48 8d 4d 50                 	leaq	0x50(%rbp), %rcx
180b75057: e8 64 1d 5f ff              	callq	0x180166dc0 <.text+0x165dc0>
180b7505c: 48 8b 4d 50                 	movq	0x50(%rbp), %rcx
180b75060: 48 89 7d 60                 	movq	%rdi, 0x60(%rbp)
180b75064: 89 5c f9 f8                 	movl	%ebx, -0x8(%rcx,%rdi,8)
180b75068: 89 74 f9 fc                 	movl	%esi, -0x4(%rcx,%rdi,8)
180b7506c: 48 8b 4d 48                 	movq	0x48(%rbp), %rcx
180b75070: 8b 41 10                    	movl	0x10(%rcx), %eax
180b75073: 85 c0                       	testl	%eax, %eax
180b75075: 75 0e                       	jne	0x180b75085 <UnityMain+0x4e4755>
180b75077: 33 d2                       	xorl	%edx, %edx
180b75079: 48 8d 4c 24 78              	leaq	0x78(%rsp), %rcx
180b7507e: e8 7d fd ff ff              	callq	0x180b74e00 <UnityMain+0x4e44d0>
180b75083: eb 6b                       	jmp	0x180b750f0 <UnityMain+0x4e47c0>
180b75085: 3c 04                       	cmpb	$0x4, %al
180b75087: 75 67                       	jne	0x180b750f0 <UnityMain+0x4e47c0>
180b75089: 8b 51 08                    	movl	0x8(%rcx), %edx
180b7508c: 48 8d 4c 24 78              	leaq	0x78(%rsp), %rcx
180b75091: 4c 89 b4 24 38 02 00 00     	movq	%r14, 0x238(%rsp)
180b75099: e8 62 fd ff ff              	callq	0x180b74e00 <UnityMain+0x4e44d0>
180b7509e: 48 8b 45 48                 	movq	0x48(%rbp), %rax
180b750a2: 48 8b 74 24 78              	movq	0x78(%rsp), %rsi
180b750a7: 48 8b 38                    	movq	(%rax), %rdi
180b750aa: 8b 40 08                    	movl	0x8(%rax), %eax
180b750ad: 48 8d 0c 40                 	leaq	(%rax,%rax,2), %rcx
180b750b1: 4c 8d 34 cf                 	leaq	(%rdi,%rcx,8), %r14
180b750b5: 49 3b fe                    	cmpq	%r14, %rdi
180b750b8: 74 2e                       	je	0x180b750e8 <UnityMain+0x4e47b8>
180b750ba: 4c 8d 2d 2f 5b c2 00        	leaq	0xc25b2f(%rip), %r13    # 0x18179abf0
180b750c1: 48 8d 55 e0                 	leaq	-0x20(%rbp), %rdx
180b750c5: 48 89 7d 48                 	movq	%rdi, 0x48(%rbp)
180b750c9: 48 8b ce                    	movq	%rsi, %rcx
180b750cc: 4c 89 6d 10                 	movq	%r13, 0x10(%rbp)
180b750d0: e8 7b f7 ff ff              	callq	0x180b74850 <UnityMain+0x4e3f20>
180b750d5: 48 81 c6 a8 00 00 00        	addq	$0xa8, %rsi
180b750dc: 48 83 c7 18                 	addq	$0x18, %rdi
180b750e0: 49 3b fe                    	cmpq	%r14, %rdi
180b750e3: 75 dc                       	jne	0x180b750c1 <UnityMain+0x4e4791>
180b750e5: 45 33 ed                    	xorl	%r13d, %r13d
180b750e8: 4c 8b b4 24 38 02 00 00     	movq	0x238(%rsp), %r14
180b750f0: 48 ff 4d 60                 	decq	0x60(%rbp)
180b750f4: bf 00 00 00 80              	movl	$0x80000000, %edi       # imm = 0x80000000
180b750f9: 48 8b b4 24 68 02 00 00     	movq	0x268(%rsp), %rsi
180b75101: c6 45 40 01                 	movb	$0x1, 0x40(%rbp)
180b75105: 4c 89 65 10                 	movq	%r12, 0x10(%rbp)
180b75109: 4c 8b a4 24 48 02 00 00     	movq	0x248(%rsp), %r12
180b75111: 4c 89 7d 48                 	movq	%r15, 0x48(%rbp)
180b75115: 48 8d 4c 24 78              	leaq	0x78(%rsp), %rcx
180b7511a: e8 91 bf 91 ff              	callq	0x1804910b0 <.text+0x4900b0>
180b7511f: 48 8d 4d e0                 	leaq	-0x20(%rbp), %rcx
180b75123: e8 88 df de ff              	callq	0x1809630b0 <UnityMain+0x2d2780>
180b75128: 4c 8b bc 24 30 02 00 00     	movq	0x230(%rsp), %r15
180b75130: eb 0c                       	jmp	0x180b7513e <UnityMain+0x4e480e>
180b75132: 48 8d 0d f7 5a c2 00        	leaq	0xc25af7(%rip), %rcx    # 0x18179ac30
180b75139: e8 02 0c 24 00              	callq	0x180db5d40 <UnityMain+0x725410>
180b7513e: 66 0f 6f 05 fa 70 b0 00     	movdqa	0xb070fa(%rip), %xmm0   # 0x18167c240
180b75146: 48 8b 05 93 4f ea 00        	movq	0xea4f93(%rip), %rax    # 0x181a1a0e0
180b7514d: 66 0f 7f 45 b0              	movdqa	%xmm0, -0x50(%rbp)
180b75152: 66 0f 7f 45 d0              	movdqa	%xmm0, -0x30(%rbp)
180b75157: 4c 89 6d a0                 	movq	%r13, -0x60(%rbp)
180b7515b: c7 45 a8 01 00 00 00        	movl	$0x1, -0x58(%rbp)
180b75162: 4c 89 6d c0                 	movq	%r13, -0x40(%rbp)
180b75166: c7 45 c8 01 00 00 00        	movl	$0x1, -0x38(%rbp)
180b7516d: 0f 1f 00                    	nopl	(%rax)
180b75170: 48 ff c3                    	incq	%rbx
180b75173: 80 3c 18 00                 	cmpb	$0x0, (%rax,%rbx)
180b75177: 75 f7                       	jne	0x180b75170 <UnityMain+0x4e4840>
180b75179: 48 8d 54 24 40              	leaq	0x40(%rsp), %rdx
180b7517e: 48 89 44 24 40              	movq	%rax, 0x40(%rsp)
180b75183: 48 8d 4c 24 50              	leaq	0x50(%rsp), %rcx
180b75188: 48 89 5c 24 48              	movq	%rbx, 0x48(%rsp)
180b7518d: e8 1e b8 9c ff              	callq	0x1805409b0 <.text+0x53f9b0>
180b75192: 48 8b 9c 24 60 02 00 00     	movq	0x260(%rsp), %rbx
180b7519a: 84 c0                       	testb	%al, %al
180b7519c: 74 52                       	je	0x180b751f0 <UnityMain+0x4e48c0>
180b7519e: 80 7c 24 70 01              	cmpb	$0x1, 0x70(%rsp)
180b751a3: 48 8d 54 24 50              	leaq	0x50(%rsp), %rdx
180b751a8: 44 89 6c 24 30              	movl	%r13d, 0x30(%rsp)
180b751ad: 48 8d 4d e0                 	leaq	-0x20(%rbp), %rcx
180b751b1: 48 0f 45 54 24 50           	cmovneq	0x50(%rsp), %rdx
180b751b7: 41 b9 01 00 00 00           	movl	$0x1, %r9d
180b751bd: 4c 89 6c 24 28              	movq	%r13, 0x28(%rsp)
180b751c2: 4c 8b c7                    	movq	%rdi, %r8
180b751c5: c6 44 24 20 00              	movb	$0x0, 0x20(%rsp)
180b751ca: e8 61 da de ff              	callq	0x180962c30 <UnityMain+0x2d2300>
180b751cf: 48 8d 55 e0                 	leaq	-0x20(%rbp), %rdx
180b751d3: 48 8d 4d a0                 	leaq	-0x60(%rbp), %rcx
180b751d7: e8 f4 f9 ff ff              	callq	0x180b74bd0 <UnityMain+0x4e42a0>
180b751dc: 48 8d 4d a0                 	leaq	-0x60(%rbp), %rcx
180b751e0: e8 cb 18 ab ff              	callq	0x180626ab0 <.text+0x625ab0>
180b751e5: 48 8d 4d e0                 	leaq	-0x20(%rbp), %rcx
180b751e9: e8 c2 de de ff              	callq	0x1809630b0 <UnityMain+0x2d2780>
180b751ee: eb 13                       	jmp	0x180b75203 <UnityMain+0x4e48d3>
180b751f0: 48 8b 15 e9 4e ea 00        	movq	0xea4ee9(%rip), %rdx    # 0x181a1a0e0
180b751f7: 48 8d 0d 92 5a c2 00        	leaq	0xc25a92(%rip), %rcx    # 0x18179ac90
180b751fe: e8 3d 0b 24 00              	callq	0x180db5d40 <UnityMain+0x725410>
180b75203: 48 8d 4d c0                 	leaq	-0x40(%rbp), %rcx
180b75207: e8 34 38 58 ff              	callq	0x1800f8a40 <.text+0xf7a40>
180b7520c: 48 8d 4d a0                 	leaq	-0x60(%rbp), %rcx
180b75210: e8 6b 3a 58 ff              	callq	0x1800f8c80 <.text+0xf7c80>
180b75215: 80 7c 24 70 00              	cmpb	$0x0, 0x70(%rsp)
180b7521a: 4c 8b ac 24 40 02 00 00     	movq	0x240(%rsp), %r13
180b75222: 48 8b bc 24 70 02 00 00     	movq	0x270(%rsp), %rdi
180b7522a: 75 1b                       	jne	0x180b75247 <UnityMain+0x4e4917>
180b7522c: 8b 54 24 74                 	movl	0x74(%rsp), %edx
