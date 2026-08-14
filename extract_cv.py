import PyPDF2
reader = PyPDF2.PdfReader('/home/ubuntu/app/Semih_Kilic_CV.pdf')
for i, page in enumerate(reader.pages):
    text = page.extract_text()
    print(f'--- PAGE {i+1} ---')
    print(text)
